/**
 * Loader for the lcm_native Node-API module (crates/lcm-native), typed by its contract.
 * The binary loads on first use, so a missing module fails the session start, not the import.
 */

import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Conversation, LcmStats, SearchResult, SourceRef, StoredMessage, Summary } from "./db/store.js";

export interface MigrationReport {
  conversations: number;
  messages: number;
  summaries: number;
  sources: number;
}

export interface RegexSearch {
  results: SearchResult[];
  timed_out: boolean;
}

export interface LcmDb {
  lastMigration(): MigrationReport | null;
  getOrCreateConversation(sessionId: string, sessionFile: string | null, cwd: string): Conversation;
  appendMessage(
    conversationId: string,
    entryId: string | null,
    role: string,
    toolName: string | null,
    timestamp: number,
    contentText: string,
    contentJson: string,
  ): StoredMessage | null;
  getMessagesByIds(ids: string[]): StoredMessage[];
  getUncompactedMessages(conversationId: string): StoredMessage[];
  getUncompactedTokens(conversationId: string): number;
  getMessageCount(conversationId: string): number;
  searchMessages(conversationId: string, query: string, limit?: number | null, after?: number | null, before?: number | null): SearchResult[];
  searchMessagesRegex(conversationId: string, pattern: string, limit?: number | null, timeoutMs?: number | null): RegexSearch;
  searchSummaries(conversationId: string, query: string, limit?: number | null): Summary[];
  createLeafSummary(conversationId: string, text: string, messageIds: string[], metadataJson: string | null): Summary;
  createCondensedSummary(conversationId: string, depth: number, text: string, childSummaryIds: string[], metadataJson: string | null): Summary;
  getSummary(id: string): Summary | null;
  getSummarySources(summaryId: string): SourceRef[];
  getSummaryLineage(summaryId: string): Summary[];
  getSummariesByDepth(conversationId: string, depth: number): Summary[];
  getUnconsumedSummariesByDepth(conversationId: string, depth: number): Summary[];
  getMaxDepth(conversationId: string): number;
  getAllSummaries(conversationId: string, limit?: number | null): Summary[];
  getLatestSummaryPerDepth(conversationId: string): Summary[];
  getStats(conversationId: string): LcmStats;
  assembleSummary(conversationId: string, maxTokens: number): string;
  checkpoint(): void;
  close(): void;
}

export interface LcmNativeModule {
  migrateLegacy(legacyPath: string, dbPath: string): MigrationReport;
  LcmDb: {
    open(dbPath: string, cwd: string, legacyPath?: string | null): LcmDb;
  };
}

let loaded: LcmNativeModule | null = null;

/** Returns the lcm_native module for this platform. Throws when the binary is not installed. */
export function nativeModule(): LcmNativeModule {
  if (loaded) return loaded;
  const here = fileURLToPath(import.meta.url);
  const file = join(dirname(here), "..", "native", `lcm_native.${process.platform}-${process.arch}.node`);
  if (!existsSync(file)) {
    throw new Error(
      `LCM native module not found: ${file}. Build it with node crates/lcm-native/build.mjs or install it from the GitHub Release.`,
    );
  }
  loaded = createRequire(import.meta.url)(file) as LcmNativeModule;
  return loaded;
}
