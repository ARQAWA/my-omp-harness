/**
 * CompactionEngine: two-phase DAG compaction (leaf + condensed).
 *
 * Fix 9: Per-conversation mutex.
 * Fix 10: Condensed pass uses unconsumed summaries, < threshold, bounded cascade.
 * Fix 11: No mark-compacted on summarization failure.
 */

import type { LcmStore, StoredMessage, SourceRef } from "../db/store.js";
import type { LcmConfig } from "../config.js";
import { mapConcurrent } from "../utils.js";
import {
  buildLeafPrompt,
  buildCondensedD1Prompt,
  buildCondensedD2PlusPrompt,
  serializeMessagesForPrompt,
} from "./prompts.js";

const MAX_CONDENSE_PASSES = 10;

// One summarizer call must stay under 100k tokens of input plus output to keep the cheaper price tier.
const CALL_TOKEN_LIMIT = 100_000;
export const SUMMARY_MAX_OUTPUT_TOKENS = 16_000;
const PROMPT_OVERHEAD_TOKENS = 3_000; // instructions and system prompt
const CHARS_PER_TOKEN_FLOOR = 1.5; // observed 1.9-2.8 characters per real token on this workload
const MAX_INPUT_CHARS = Math.floor((CALL_TOKEN_LIMIT - SUMMARY_MAX_OUTPUT_TOKENS - PROMPT_OVERHEAD_TOKENS) * CHARS_PER_TOKEN_FLOOR);

export interface CompactionDeps {
  summarize: (systemPrompt: string, signal?: AbortSignal, reasoning?: "low" | "high" | "xhigh", kind?: "leaf" | "condense") => Promise<string>;
  notify: (message: string, type?: string) => void;
}

export class CompactionEngine {
  private store: LcmStore;
  private config: LcmConfig;
  // Fix 9: Per-conversation mutex
  private locks = new Map<string, Promise<string | null>>();

  constructor(store: LcmStore, config: LcmConfig) {
    this.store = store;
    this.config = config;
  }

  private enqueue(conversationId: string, job: () => Promise<void>): Promise<void> {
    const prev = this.locks.get(conversationId) ?? Promise.resolve(null);
    const current = prev.then(job).then(() => null);
    this.locks.set(conversationId, current);
    return current.then(() => undefined).finally(() => {
      if (this.locks.get(conversationId) === current) this.locks.delete(conversationId);
    });
  }

  /** Background run: summarize full chunks only (the last partial chunk keeps accumulating), then condense. */
  async backgroundRun(conversationId: string, deps: CompactionDeps, signal?: AbortSignal): Promise<void> {
    return this.enqueue(conversationId, async () => {
      const uncompacted = this.store.getUncompactedMessages(conversationId);
      const chunks = this.chunkMessages(uncompacted, this.config.leafChunkTokens);
      if (chunks.length <= 1) return;
      await this.leafPass(conversationId, chunks.slice(0, -1).flat(), deps, signal);
      if (signal?.aborted) return;
      await this.condensedPass(conversationId, deps, signal);
    });
  }

  /** Compaction-time top-up: summarize every remaining uncompacted message, then condense. */
  async finalize(conversationId: string, deps: CompactionDeps, signal?: AbortSignal): Promise<void> {
    return this.enqueue(conversationId, async () => {
      if (signal?.aborted) return;
      const uncompacted = this.store.getUncompactedMessages(conversationId);
      if (uncompacted.length > 0) {
        await this.leafPass(conversationId, uncompacted, deps, signal);
      }
      if (signal?.aborted) return;
      await this.condensedPass(conversationId, deps, signal);
    });
  }

  // ── Leaf Pass ─────────────────────────────────────────────────

  private async leafPass(
    conversationId: string,
    messages: StoredMessage[],
    deps: CompactionDeps,
    signal?: AbortSignal,
  ): Promise<void> {
    const chunks = this.chunkMessages(messages, this.config.leafChunkTokens);

    deps.notify(`LCM: Processing ${chunks.length} chunks (concurrency ${this.config.leafPassConcurrency})...`, "info");

    const results = await mapConcurrent(
      chunks,
      this.config.leafPassConcurrency,
      async (chunk, idx) => {
        if (signal?.aborted) throw new Error("Aborted");

        const keep = MAX_INPUT_CHARS - 1000;
        const fitted = chunk.map((m) => {
          if (m.content_text.length <= keep) return m;
          const head = m.content_text.slice(0, Math.floor(keep * 0.6));
          const tail = m.content_text.slice(m.content_text.length - (keep - head.length));
          const omitted = m.content_text.length - head.length - tail.length;
          return { ...m, content_text: `${head}\n[... ${omitted} characters omitted to fit the summarizer input limit ...]\n${tail}` };
        });
        const serialized = serializeMessagesForPrompt(fitted);
        const prompt = buildLeafPrompt(serialized);

        try {
          const summaryText = await deps.summarize(prompt, signal, undefined, "leaf");
          return { chunk, summaryText, failed: false };
        } catch {
          // Fix 11: Mark as failed — do NOT persist or mark compacted
          return { chunk, summaryText: "", failed: true };
        }
      },
    );

    for (const result of results) {
      if (result.status === "rejected") continue;
      const { chunk, summaryText, failed } = result.value;

      // Fix 11: Skip failed chunks — messages stay uncompacted for retry next cycle
      if (failed) {
        deps.notify(
          `LCM: Summarization failed for messages ${chunk[0].seq}-${chunk[chunk.length - 1].seq}, will retry next cycle`,
          "warning",
        );
        continue;
      }

      const sources: SourceRef[] = chunk.map((m) => ({
        source_type: "message" as const,
        source_id: m.id,
      }));

      this.store.createSummary(conversationId, 0, summaryText, sources, {
        messageRange: { from: chunk[0].seq, to: chunk[chunk.length - 1].seq },
      });

      this.store.markCompacted(chunk.map((m) => m.id));
    }
  }

  // ── Condensed Pass ────────────────────────────────────────────

  /**
   * Fix 10a: Use getUnconsumedSummariesByDepth (NOT EXISTS filter).
   * Fix 10b: Threshold uses < not <= (condense AT threshold, not above).
   * Fix 10c: Bounded cascade loop (MAX_CONDENSE_PASSES = 10).
   */
  private async condensedPass(
    conversationId: string,
    deps: CompactionDeps,
    signal?: AbortSignal,
  ): Promise<void> {
    let didCondense = true;
    let passes = 0;

    while (didCondense && passes < MAX_CONDENSE_PASSES) {
      didCondense = false;
      passes++;

      for (let depth = 0; depth < this.config.maxDepth; depth++) {
        if (signal?.aborted) return;

        // Fix 10a: Only count/select unconsumed summaries
        const unconsumed = this.store.getUnconsumedSummariesByDepth(conversationId, depth);
        // Fix 10b: < threshold (condense at threshold count, not above)
        if (unconsumed.length < this.config.condensationThreshold) continue;

        let toCondense = unconsumed.slice(0, this.config.condensationThreshold);
        let combinedText = toCondense.map((s) => s.text).join("\n\n---\n\n");
        while (combinedText.length > MAX_INPUT_CHARS && toCondense.length > 2) {
          toCondense = toCondense.slice(0, -1);
          combinedText = toCondense.map((s) => s.text).join("\n\n---\n\n");
        }
        if (combinedText.length > MAX_INPUT_CHARS) {
          deps.notify(`LCM: D${depth} summaries too large to condense within the input limit, skipping`, "warning");
          continue;
        }

        deps.notify(
          `LCM: Condensing ${toCondense.length} D${depth} summaries into D${depth + 1}...`,
          "info",
        );

        const prompt =
          depth + 1 === 1
            ? buildCondensedD1Prompt(combinedText)
            : buildCondensedD2PlusPrompt(depth + 1, combinedText);

        let summaryText: string;
        try {
          summaryText = await deps.summarize(prompt, signal, "low", "condense");
        } catch {
          deps.notify(`LCM: Condensation at D${depth + 1} failed, will retry next cycle`, "warning");
          return; // Stop cascading on failure
        }

        const sources: SourceRef[] = toCondense.map((s) => ({
          source_type: "summary" as const,
          source_id: s.id,
        }));

        this.store.createSummary(conversationId, depth + 1, summaryText, sources, {
          sourceSummaryIds: toCondense.map((s) => s.id),
        });

        didCondense = true;
      }
    }

    if (passes >= MAX_CONDENSE_PASSES) {
      deps.notify("LCM: Condensation hit pass limit, will continue next cycle", "warning");
    }
  }

  private chunkMessages(messages: StoredMessage[], tokenBudget: number): StoredMessage[][] {
    const chunks: StoredMessage[][] = [];
    let current: StoredMessage[] = [];
    let tokens = 0;
    let chars = 0;

    for (const msg of messages) {
      const msgTokens = msg.token_estimate; // Already min 1 from store
      const msgChars = msg.content_text.length + 40; // label and separators
      if ((tokens + msgTokens > tokenBudget || chars + msgChars > MAX_INPUT_CHARS) && current.length > 0) {
        chunks.push(current);
        current = [];
        tokens = 0;
        chars = 0;
      }
      current.push(msg);
      tokens += msgTokens;
      chars += msgChars;
    }

    if (current.length > 0) chunks.push(current);
    return chunks;
  }
}
