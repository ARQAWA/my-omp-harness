/**
 * Assemble a compaction summary from the DAG for Pi's compaction entry.
 * The output is a STATIC structure (content only changes on compaction, not per-turn).
 */

import type { LcmStore, Summary, LcmStats } from "../db/store.js";
import { estimateTokens } from "../utils.js";

export function assembleSummary(
  store: LcmStore,
  conversationId: string,
  maxTokens: number,
): string {
  const stats = store.getStats(conversationId);
  const latestPerDepth = store.getLatestSummaryPerDepth(conversationId);

  if (latestPerDepth.length === 0) {
    return `## Conversation History (Lossless Context Management)\n${stats.messages} messages stored | 0 summaries\n\nNo summaries generated yet.`;
  }

  const parts: string[] = [];

  // Header with stats
  parts.push(`## Conversation History (Lossless Context Management)`);
  parts.push(
    `${stats.messages} messages stored | ${stats.summaries} summaries | DAG depth ${stats.maxDepth}`,
  );
  parts.push("");

  // Fill from deepest summaries first (broadest coverage)
  let tokensUsed = estimateTokens(parts.join("\n"));

  // Collect unconsumed summaries: deepest levels first, then D0; each chronological
  const ordered: Summary[] = [];
  for (let depth = stats.maxDepth; depth >= 1; depth--) {
    ordered.push(...store.getUnconsumedSummariesByDepth(conversationId, depth));
  }
  ordered.push(...store.getUnconsumedSummariesByDepth(conversationId, 0));

  // Budget selection fills newest-created first across all levels; older ones drop out
  let selected: Summary[] = [];
  for (const s of [...ordered].sort((a, b) => b.created_at.localeCompare(a.created_at))) {
    const needed = estimateTokens(s.text) + 20; // +20 for formatting
    if (tokensUsed + needed > maxTokens) break;
    selected.push(s);
    tokensUsed += needed;
  }
  const ids = new Set(selected.map((s) => s.id));
  selected = ordered.filter((s) => ids.has(s.id));

  const highLevel = selected.filter((s) => s.depth >= 1);
  if (highLevel.length > 0) {
    parts.push("### High-Level Summary");
    for (const s of highLevel) {
      parts.push(`#### D${s.depth}`);
      parts.push(s.text);
      parts.push("");
    }
  }

  const recent = selected.filter((s) => s.depth === 0);
  if (recent.length > 0) {
    parts.push("### Recent Activity");
    for (const s of recent) {
      parts.push("#### D0");
      parts.push(s.text);
      parts.push("");
    }
  }

  // Summary IDs for drill-down
  const allSummaries = store.getAllSummaries(conversationId);
  if (allSummaries.length > 0) {
    parts.push("### Summary IDs for Drill-Down");
    const idBudget = maxTokens - tokensUsed - 50;
    let idTokens = 0;
    for (const s of allSummaries) {
      const preview = s.text.slice(0, 60).replace(/\n/g, " ");
      const line = `- ${s.id} (D${s.depth}): "${preview}..."`;
      const lineTokens = estimateTokens(line);
      if (idTokens + lineTokens > idBudget) break;
      parts.push(line);
      idTokens += lineTokens;
    }
  }

  return parts.join("\n");
}
