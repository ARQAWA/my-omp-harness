/**
 * pi-lcm: Lossless Context Management extension for Pi.
 *
 * Session lifecycle: per-event detection with no global flags.
 *   - session_start: initializes LCM for the session.
 *   - session_switch: omp event; re-initializes LCM for the switched session.
 * message_end has no entryId — always pass null.
 */

import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { type Component, Text } from "@oh-my-pi/pi-tui";
import { type ToolRenderer, toolRenderers } from "@oh-my-pi/pi-tui/tools";
import { completeSimple, type AssistantMessage } from "@oh-my-pi/pi-ai";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { resolveConfig, type LcmConfig } from "./src/config.js";
import { LcmStore } from "./src/db/store.js";
import { nativeModule, type LcmDb } from "./src/native.js";
import { CompactionEngine, SUMMARY_MAX_OUTPUT_TOKENS, type CompactionDeps } from "./src/compaction/engine.js";
import { SUMMARIZER_SYSTEM_PROMPT } from "./src/compaction/prompts.js";
import { hashCwd } from "./src/utils.js";
import { persistMessage, type PersistorState } from "./src/persistor.js";
import { LCM_SYSTEM_PREAMBLE } from "./src/context.js";
import { handleLcmCommand, type CommandState } from "./src/commands.js";
import { updateStatus } from "./src/status.js";
import { createLcmGrepTool } from "./src/tools/lcm-grep.js";
import { createLcmDescribeTool } from "./src/tools/lcm-describe.js";
import { createLcmExpandTool } from "./src/tools/lcm-expand.js";
import { loadSettings, saveSettings, LEGACY_LCM_DIR, type SettingsScope } from "./src/settings.js";
import { LcmSettingsPanel, type LcmPanelDeps } from "./src/settings-panel.js";

/** TRUNCATE checkpoint of the WAL file. Never throws. */
function checkpointDb(handle: LcmDb): void {
  try { handle.checkpoint(); } catch { /* non-fatal */ }
}

/** Checkpoints and closes the database handle. Never throws. */
function closeDb(handle: LcmDb): void {
  checkpointDb(handle);
  try { handle.close(); } catch { /* ignore close errors */ }
}

/** Appends one JSON line per model call to costs.jsonl in the DB directory. Never throws. */
function logCompactionCost(
  logDir: string,
  ctx: { sessionManager?: { getSessionId?: () => string } },
  kind: "leaf" | "condense",
  modelRef: string,
  reasoning: "low" | "high" | "xhigh",
  started: number,
  response: AssistantMessage,
): void {
  try {
    const usage = response.usage;
    const entry = {
      ts: new Date().toISOString(),
      sessionId: ctx.sessionManager?.getSessionId?.() ?? null,
      kind,
      model: modelRef,
      reasoning,
      durationMs: Date.now() - started,
      tokens: {
        input: usage?.input ?? 0,
        output: usage?.output ?? 0,
        cacheRead: usage?.cacheRead ?? 0,
        cacheWrite: usage?.cacheWrite ?? 0,
      },
      cost: {
        input: usage?.cost?.input ?? 0,
        output: usage?.cost?.output ?? 0,
        cacheRead: usage?.cost?.cacheRead ?? 0,
        cacheWrite: usage?.cost?.cacheWrite ?? 0,
        total: usage?.cost?.total ?? 0,
      },
    };
    mkdirSync(logDir, { recursive: true });
    appendFileSync(join(logDir, "costs.jsonl"), JSON.stringify(entry) + "\n");
  } catch (e: unknown) {
    console.error("[LCM] Cost log write failed:", e instanceof Error ? e.message : e);
  }
}

type RegisterTool = Parameters<ExtensionAPI["registerTool"]>[0];

/** The first line of the first text block of a tool result. */
function firstTextLine(result: unknown): string {
  const content =
    typeof result === "object" && result !== null && "content" in result && Array.isArray(result.content)
      ? result.content
      : [];
  for (const block of content) {
    if (typeof block === "object" && block !== null && "text" in block && typeof block.text === "string") {
      return block.text.split("\n")[0] ?? "";
    }
  }
  return "";
}

/** Adds renderers that call omp's renderer for the tool's name at render time, so the feed's patched renderers draw it; plain text when there is none. */
function withSharedRender<T extends { name: string; label?: string }>(tool: T): RegisterTool {
  // The tool objects come from the lcm package's own types, which do not match omp's ToolDefinition; the shape is checked at runtime by omp.
  return {
    ...tool,
    renderCall: (...args: Parameters<ToolRenderer["renderCall"]>): Component => {
      const host = toolRenderers[tool.name];
      return host ? (host.renderCall(...args) as Component) : new Text(tool.label ?? tool.name, 0, 0);
    },
    renderResult: (...args: Parameters<ToolRenderer["renderResult"]>): Component => {
      const host = toolRenderers[tool.name];
      return host ? (host.renderResult(...args) as Component) : new Text(firstTextLine(args[0]), 0, 0);
    },
  } as unknown as RegisterTool;
}

export default function (pi: ExtensionAPI) {
  let config = resolveConfig(process.cwd());
  if (!config.enabled) return;

  // ── Shared state ────────────────────────────────────────────────

  let store: LcmStore | null = null;
  let db: LcmDb | null = null;
  let settingsScope: SettingsScope = "global";
  let conversationId: string | null = null;
  let hasCompactedHistory = false;
  let cachedGuidelines: string[] = [];

  const COMPACT_DEADLINE_MS = 25_000;
  let bgRunning = false;
  let engineCache: { store: LcmStore; engine: CompactionEngine } | null = null;
  // One engine per store so background runs and compaction share its per-conversation lock
  function getEngine(s: LcmStore): CompactionEngine {
    if (!engineCache || engineCache.store !== s) engineCache = { store: s, engine: new CompactionEngine(s, config) };
    return engineCache.engine;
  }

  const getStore = () => store;
  const getConversationId = () => conversationId;
  const getGuidelines = () => cachedGuidelines;

  function updateGuidelines(): void {
    if (!store || !conversationId) { cachedGuidelines = []; return; }
    const stats = store.getStats(conversationId);
    cachedGuidelines = [
      `LCM has ${stats.messages} stored messages across ${stats.summaries} summaries (max depth ${stats.maxDepth}).`,
      "Use lcm_grep when you need to find something specific from earlier in the conversation.",
      "Use lcm_expand to recover exact details from compressed summaries.",
    ];
  }

  // Shared initialization logic
  function initializeSession(ctx: any): void {
    const sessionId = ctx.sessionManager.getSessionId();
    const sessionFile = ctx.sessionManager.getSessionFile?.() ?? null;
    const cwd = ctx.cwd;

    if (!sessionId || !cwd) return;

    // Reload config (may have been changed via /lcm-settings)
    config = resolveConfig(cwd);
    // Disabled in settings: no database, so hooks and tools do nothing
    if (!config.enabled) { resetState(); return; }
    const loaded = loadSettings(cwd);
    settingsScope = loaded.source === "project" ? "project" : "global";

    if (db) { closeDb(db); db = null; }
    const dbFile = `${hashCwd(cwd)}.db`;
    const legacyPath = join(LEGACY_LCM_DIR, dbFile);
    db = nativeModule().LcmDb.open(join(config.dbDir, dbFile), cwd, legacyPath);
    const migration = db.lastMigration();
    if (migration) {
      ctx.ui.notify(`LCM migrated ${migration.messages} messages and ${migration.summaries} summaries from ${legacyPath}.`, "info");
    }

    store = new LcmStore(db);
    const conv = store.getOrCreateConversation(sessionId, sessionFile, cwd);
    conversationId = conv.id;

    const stats = store.getStats(conversationId);
    hasCompactedHistory = stats.summaries > 0;

    updateGuidelines();
    updateStatus(store, conversationId, ctx);
  }

  function resetState(): void {
    if (db) closeDb(db);
    db = null;
    store = null;
    conversationId = null;
    hasCompactedHistory = false;
    cachedGuidelines = [];
  }

  // ── Register tools ──────────────────────────────────────────────

  pi.registerTool(withSharedRender(createLcmGrepTool(getStore, getConversationId, getGuidelines)));
  pi.registerTool(withSharedRender(createLcmDescribeTool(getStore, getConversationId)));
  pi.registerTool(withSharedRender(createLcmExpandTool(getStore, getConversationId)));

  pi.registerCommand("lcm", {
    description: "Lossless Context Management: stats, tree, compact, settings",
    handler: async (args: string | undefined, ctx: any) => {
      const sub = args?.split(" ")[0];
      if (sub === "settings") {
        await openSettingsPanel(ctx);
        return;
      }
      handleLcmCommand({ store, conversationId, config }, args, ctx);
    },
  });

  pi.registerCommand("lcm-settings", {
    description: "Open LCM settings panel",
    handler: async (_args: string | undefined, ctx: any) => {
      await openSettingsPanel(ctx);
    },
  });

  async function openSettingsPanel(ctx: any): Promise<void> {
    const loaded = loadSettings(ctx.cwd);
    settingsScope = loaded.source === "project" ? "project" : "global";

    const panelDeps: LcmPanelDeps = {
      config: { ...config },
      scope: settingsScope,
      cwd: ctx.cwd,
      stats: store && conversationId ? store.getStats(conversationId) : null,
      save: (cfg: LcmConfig, scope: SettingsScope, cwd: string) => {
        // Persist to settings.json
        const { enabled, leafChunkTokens, condensationThreshold, maxDepth,
                maxSummaryTokens, leafPassConcurrency,
                debugMode } = cfg;
        saveSettings(
          { enabled, leafChunkTokens, condensationThreshold, maxDepth,
            maxSummaryTokens, leafPassConcurrency, debugMode },
          scope,
          cwd,
        );
        // Update live config
        config = resolveConfig(cwd);
        if (!config.enabled) {
          resetState();
        } else if (!store) {
          try {
            initializeSession(ctx);
          } catch (e: any) {
            console.error("[LCM] Re-init failed after settings change:", e.message);
            resetState();
          }
        }
        settingsScope = scope;
        ctx.ui.notify("Memory settings saved", "success");
      },
    };

    const panel = new LcmSettingsPanel(panelDeps);

    // Pi's ctx.ui.custom API: (tui, theme, keybindings, done) => Component
    // done() closes the overlay. Wire panel.onClose to done().
    await ctx.ui.custom(
      (_tui: any, _theme: any, _kb: any, done: () => void) => {
        panel.onClose = () => done();
        return panel;
      },
      {
        overlay: true,
        overlayOptions: {
          width: "60%",
          minWidth: 36,
          maxHeight: "70%",
          anchor: "center",
        },
      },
    );
  }

  // ── Session lifecycle ───────────────────────────────────────────

  pi.on("session_start", async (_event: unknown, ctx: any) => {
    try {
      initializeSession(ctx);
    } catch (e: any) {
      console.error("[LCM] Failed to initialize:", e.message);
      ctx.ui.notify(`Memory could not start: ${e.message}`, "warning");
      resetState();
    }
  });

  // omp emits session_switch when the session is switched
  pi.on("session_switch", async (_event: any, ctx: any) => {
    resetState();
    try {
      initializeSession(ctx);
    } catch (e: any) {
      console.error("[LCM] Re-init failed on session switch:", e.message);
      resetState();
    }
  });

  pi.on("session_shutdown", async (_event: any, _ctx: any) => {
    resetState();
  });

  // ── Message persistence ─────────────────────────────────────────

  pi.on("message_end", async (event: any, ctx: any) => {
    if (!store || !conversationId) return;

    // message_end has no entryId field — always null
    const state: PersistorState = { store, conversationId };
    persistMessage(state, event.message, null);

    const count = store.getMessageCount(conversationId);
    if (count % 10 === 0) updateStatus(store, conversationId, ctx);

    // Background summaries: fire-and-forget, at most one run at a time
    if (bgRunning) return;
    const s = store;
    const convId = conversationId;
    if (s.getUncompactedTokens(convId) <= config.leafChunkTokens) return;

    bgRunning = true;
    const engine = getEngine(s);
    const deps: CompactionDeps = {
      summarize: (prompt: string, sig?: AbortSignal, reasoning?: "low" | "high" | "xhigh", kind?: "leaf" | "condense") => callCompactionModel(ctx, config, prompt, sig, reasoning, kind),
      notify: (message: string, type?: string) => { try { ctx.ui.notify(message, type ?? "info"); } catch {} },
      onProgress: text => { try { ctx.ui.setStatus("lcm", text); } catch {} },
    };
    engine
      .backgroundRun(convId, deps)
      .catch((e: unknown) => console.error("[LCM] Background summarization failed:", e instanceof Error ? e.message : e))
      .finally(() => { bgRunning = false; updateStatus(s, convId, ctx); });
  });

  // ── Custom compaction ───────────────────────────────────────────

  pi.on("session_before_compact", async (event: any, ctx: any) => {
    if (!store || !conversationId) return;

    const { preparation, signal } = event;

    // Persist branchEntries messages we may have missed (also uses content-based dedup)
    const allMessages =
      event.branchEntries
        ?.filter((e: any) => e.type === "message" && e.message)
        .map((e: any) => ({ message: e.message })) ?? [];

    for (const { message } of allMessages) {
      persistMessage({ store, conversationId }, message, null);
    }

    const engine = getEngine(store);
    const convId = conversationId;
    const s = store;

    // The hook waits at most 25 s for the background run and the top-up; unfinished work
    // continues in the background and its summaries are used at the next compaction.
    const deadline = new AbortController();
    const onAbort = () => deadline.abort();
    signal?.addEventListener?.("abort", onAbort);
    const timer = setTimeout(() => deadline.abort(), COMPACT_DEADLINE_MS);
    const timedOut = new Promise<void>((resolve) =>
      deadline.signal.addEventListener("abort", () => resolve(), { once: true }),
    );

    const deps: CompactionDeps = {
      summarize: async (prompt: string, sig?: AbortSignal, reasoning?: "low" | "high" | "xhigh", kind?: "leaf" | "condense") => {
        return await callCompactionModel(ctx, config, prompt, sig, reasoning, kind);
      },
      notify: (message: string, type?: string) => ctx.ui.notify(message, type ?? "info"),
      onProgress: text => { try { ctx.ui.setStatus("lcm", text); } catch {} },
    };

    try {
      // finalize queues behind a running background run on the engine's per-conversation lock
      const work = engine.finalize(convId, deps).catch((e: unknown) => {
        console.error("[LCM] Compaction top-up failed:", e instanceof Error ? e.message : e);
        throw e;
      });
      await Promise.race([work, timedOut]);
      clearTimeout(timer);
      signal?.removeEventListener?.("abort", onAbort);

      if (signal?.aborted) return;
      if (s.getLatestSummaryPerDepth(convId).length === 0) return; // nothing to switch to

      const summary = s.assembleSummary(convId, config.maxSummaryTokens);

      hasCompactedHistory = true;
      updateGuidelines();
      if (db) checkpointDb(db);

      return {
        compaction: {
          summary,
          firstKeptEntryId: preparation.firstKeptEntryId,
          tokensBefore: preparation.tokensBefore,
          details: { lcm: true, stats: store.getStats(conversationId) },
        },
      };
    } catch (e: any) {
      console.error("[LCM] Compaction failed:", e.message);
      ctx.ui.notify(`Memory compaction failed: ${e.message}. omp uses its normal compaction instead.`, "warning");
      return;
    } finally {
      updateStatus(s, convId, ctx);
    }
  });

  // ── System prompt injection (STATIC — cache-safe) ───────────────

  pi.on("before_agent_start", async (event: any, _ctx: any) => {
    if (!hasCompactedHistory) return;
    return { systemPrompt: event.systemPrompt + LCM_SYSTEM_PREAMBLE };
  });
}

// ── LLM call for compaction ─────────────────────────────────────

const SUMMARY_ATTEMPTS = 3; // first try plus two retries

async function callCompactionModel(ctx: any, config: LcmConfig, prompt: string, signal?: AbortSignal, reasoning: "low" | "high" | "xhigh" = "low", kind: "leaf" | "condense" = "leaf"): Promise<string> {
  let lastError: unknown = null;
  const model = ctx.modelRegistry.find?.("anthropic", "claude-haiku-5-5")
    ?? ctx.modelRegistry.getAll().find((m: any) => m.provider === "anthropic" && m.id === "claude-haiku-5-5");
  if (!model) throw new Error("No model available for compaction summarization");

  for (let attempt = 1; attempt <= SUMMARY_ATTEMPTS; attempt++) {
    try {
      let apiKey: string | undefined;
      let headers: Record<string, string> | undefined;
      if (typeof ctx.modelRegistry.getApiKeyAndHeaders === "function") {
        const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
        if (!auth || typeof auth.ok !== "boolean") throw new Error("unexpected auth response shape");
        if (!auth.ok) throw new Error("auth failed");
        if (typeof auth.apiKey !== "string" || auth.apiKey.length === 0) throw new Error("auth succeeded but apiKey is missing");
        apiKey = auth.apiKey;
        headers = auth.headers != null && typeof auth.headers === "object" ? auth.headers : undefined;
      } else {
        apiKey = await ctx.modelRegistry.getApiKey(model);
      }
      if (!apiKey) throw new Error("no API key");

      const started = Date.now();
      const response = await completeSimple(
        model,
        {
          systemPrompt: SUMMARIZER_SYSTEM_PROMPT,
          messages: [{ role: "user" as const, content: [{ type: "text" as const, text: prompt }], timestamp: Date.now() }],
        },
        { apiKey, headers, signal, reasoning, maxTokens: SUMMARY_MAX_OUTPUT_TOKENS, cacheRetention: "none" },
      );

      logCompactionCost(config.dbDir, ctx, kind, `${model.provider}/${model.id}`, reasoning, started, response);
      const text = response.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n").trim();
      if (text.length > 0) return text;
      lastError = new Error("empty summary text");
    } catch (e: unknown) {
      if (signal?.aborted) throw e;
      lastError = e;
    }
  }

  throw new Error(`LCM summarization failed after ${SUMMARY_ATTEMPTS} attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}
