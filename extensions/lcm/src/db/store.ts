/**
 * Data access layer: facade over the lcm_native database (storage, search, summary DAG and assembly live in the native module).
 * Message text extraction stays here.
 */

import type { LcmDb, RegexSearch } from "../native.js";
import { extractSearchableText } from "../utils.js";

// ── Types ─────────────────────────────────────────────────────────

export interface Conversation {
  id: string;
  session_id: string;
  session_file: string | null;
  cwd: string;
  created_at: string;
  updated_at: string;
}

export interface StoredMessage {
  id: string;
  conversation_id: string;
  entry_id: string | null;
  role: string;
  content_text: string;
  content_json: string;
  tool_name: string | null;
  token_estimate: number;
  timestamp: number;
  seq: number;
  is_compacted: number;
}

export interface Summary {
  id: string;
  conversation_id: string;
  depth: number;
  text: string;
  token_estimate: number;
  metadata_json: string | null;
  created_at: string;
}

export interface SourceRef {
  source_type: "message" | "summary";
  source_id: string;
}

export interface SearchResult {
  id: string;
  role: string;
  content_text: string;
  timestamp: number;
  seq: number;
  snippet?: string;
  summary_id?: string;
  summary_depth?: number;
}

export interface LcmStats {
  messages: number;
  summaries: number;
  maxDepth: number;
  dbSizeBytes: number;
}

// ── Store ─────────────────────────────────────────────────────────

/** ISO-8601 string to epoch milliseconds; null when absent or invalid. */
function toMs(value?: string | null): number | null {
  if (!value) return null;
  const ts = new Date(value).getTime();
  return isNaN(ts) ? null : ts;
}

export class LcmStore {
  private db: LcmDb;

  constructor(db: LcmDb) {
    this.db = db;
  }

  // ── Conversations ───────────────────────────────────────────────

  getOrCreateConversation(sessionId: string, sessionFile: string | null, cwd: string): Conversation {
    return this.db.getOrCreateConversation(sessionId, sessionFile, cwd);
  }

  // ── Messages ────────────────────────────────────────────────────

  /** Extracts the searchable text here; the native layer dedups and assigns seq. */
  appendMessage(conversationId: string, entryId: string | null, message: any): StoredMessage | null {
    if (!message || !message.role) return null;

    const contentText = extractSearchableText(message);
    const contentJson = JSON.stringify(message);
    const toolName = message.role === "toolResult" ? message.toolName ?? null : null;
    const timestamp = message.timestamp ?? Date.now();

    return this.db.appendMessage(conversationId, entryId, message.role, toolName, timestamp, contentText, contentJson);
  }

  getMessagesByIds(ids: string[]): StoredMessage[] {
    return this.db.getMessagesByIds(ids);
  }

  getUncompactedMessages(conversationId: string): StoredMessage[] {
    return this.db.getUncompactedMessages(conversationId);
  }

  getUncompactedTokens(conversationId: string): number {
    return this.db.getUncompactedTokens(conversationId);
  }

  getMessageCount(conversationId: string): number {
    return this.db.getMessageCount(conversationId);
  }

  // ── Search ──────────────────────────────────────────────────────

  searchMessages(
    conversationId: string,
    query: string,
    opts?: { limit?: number; after?: string; before?: string },
  ): SearchResult[] {
    if (!query?.trim()) return [];
    return this.db.searchMessages(conversationId, query, opts?.limit ?? null, toMs(opts?.after), toMs(opts?.before));
  }

  searchMessagesRegex(conversationId: string, pattern: string, opts?: { limit?: number; timeout?: number }): RegexSearch {
    if (!pattern?.trim()) return { results: [], timed_out: false };
    return this.db.searchMessagesRegex(conversationId, pattern, opts?.limit ?? null, opts?.timeout ?? null);
  }

  searchSummaries(conversationId: string, query: string, limit: number = 20): Summary[] {
    if (!query?.trim()) return [];
    return this.db.searchSummaries(conversationId, query, limit);
  }

  // ── Summaries (DAG) ─────────────────────────────────────────────

  createLeafSummary(conversationId: string, text: string, messageIds: string[], metadata?: unknown): Summary {
    return this.db.createLeafSummary(conversationId, text, messageIds, metadata ? JSON.stringify(metadata) : null);
  }

  createCondensedSummary(conversationId: string, depth: number, text: string, childSummaryIds: string[], metadata?: unknown): Summary {
    return this.db.createCondensedSummary(conversationId, depth, text, childSummaryIds, metadata ? JSON.stringify(metadata) : null);
  }

  getSummary(id: string): Summary | null {
    return this.db.getSummary(id);
  }

  getSummarySources(summaryId: string): SourceRef[] {
    return this.db.getSummarySources(summaryId);
  }

  getSummaryLineage(summaryId: string): Summary[] {
    return this.db.getSummaryLineage(summaryId);
  }

  getSummariesByDepth(conversationId: string, depth: number): Summary[] {
    return this.db.getSummariesByDepth(conversationId, depth);
  }

  getUnconsumedSummariesByDepth(conversationId: string, depth: number): Summary[] {
    return this.db.getUnconsumedSummariesByDepth(conversationId, depth);
  }

  getMaxDepth(conversationId: string): number {
    return this.db.getMaxDepth(conversationId);
  }

  getAllSummaries(conversationId: string, limit: number = 100): Summary[] {
    return this.db.getAllSummaries(conversationId, limit);
  }

  getLatestSummaryPerDepth(conversationId: string): Summary[] {
    return this.db.getLatestSummaryPerDepth(conversationId);
  }

  getStats(conversationId: string): LcmStats {
    return this.db.getStats(conversationId);
  }

  assembleSummary(conversationId: string, maxTokens: number): string {
    return this.db.assembleSummary(conversationId, maxTokens);
  }
}
