/**
 * Configuration resolution: env vars > settings.json (project > global) > defaults
 */

import { join, resolve, normalize, dirname } from "path";
import { readFileSync } from "fs";
import { getGlobalSettingsPath, loadSettings } from "./settings.js";

export interface LcmConfig {
  enabled: boolean;
  dbDir: string;
  leafChunkTokens: number;
  condensationThreshold: number;
  maxDepth: number;
  maxSummaryTokens: number;
  minMessagesForCompaction: number;
  leafPassConcurrency: number;
  compactionModels: { provider: string; id: string }[];
  debugMode: boolean;
}

const DEFAULTS: LcmConfig = {
  enabled: true,
  dbDir: join(dirname(process.execPath), "lcm"),
  leafChunkTokens: 30000,
  condensationThreshold: 6,
  maxDepth: 5,
  maxSummaryTokens: 32000,
  minMessagesForCompaction: 10,
  leafPassConcurrency: 15,
  compactionModels: [{ provider: "anthropic", id: "claude-haiku-5-5" }],
  debugMode: false,
};

function readSettingsLcm(): Partial<LcmConfig> {
  try {
    const settingsPath = getGlobalSettingsPath();
    const raw = readFileSync(settingsPath, "utf-8");
    const settings = JSON.parse(raw);
    return settings.lcm ?? {};
  } catch {
    return {};
  }
}

function envBool(name: string): boolean | undefined {
  const v = process.env[name];
  if (v === undefined) return undefined;
  return v === "1" || v.toLowerCase() === "true";
}

function envInt(name: string): number | undefined {
  const v = process.env[name];
  if (v === undefined) return undefined;
  const n = parseInt(v, 10);
  return isNaN(n) ? undefined : n;
}

/** Fix 14: Validate dbDir doesn't allow path traversal. */
function validateDbDir(dir: string): string {
  const resolved = resolve(normalize(dir));
  if (resolved.includes("..")) {
    throw new Error(`LCM_DB_DIR must not contain '..': ${dir}`);
  }
  return resolved;
}

export function resolveConfig(cwd?: string): LcmConfig {
  const file = cwd !== undefined ? loadSettings(cwd).config : readSettingsLcm();

  return {
    enabled: envBool("LCM_ENABLED") ?? file.enabled ?? DEFAULTS.enabled,
    dbDir: validateDbDir(process.env.LCM_DB_DIR ?? file.dbDir ?? DEFAULTS.dbDir),
    leafChunkTokens: Math.max(500, envInt("LCM_LEAF_CHUNK_TOKENS") ?? file.leafChunkTokens ?? DEFAULTS.leafChunkTokens),
    condensationThreshold: Math.max(2, envInt("LCM_CONDENSATION_THRESHOLD") ?? file.condensationThreshold ?? DEFAULTS.condensationThreshold),
    maxDepth: Math.max(1, envInt("LCM_MAX_DEPTH") ?? file.maxDepth ?? DEFAULTS.maxDepth),
    maxSummaryTokens: Math.max(500, envInt("LCM_MAX_SUMMARY_TOKENS") ?? file.maxSummaryTokens ?? DEFAULTS.maxSummaryTokens),
    minMessagesForCompaction: Math.max(2, envInt("LCM_MIN_MESSAGES") ?? file.minMessagesForCompaction ?? DEFAULTS.minMessagesForCompaction),
    leafPassConcurrency: Math.max(1, envInt("LCM_LEAF_CONCURRENCY") ?? file.leafPassConcurrency ?? DEFAULTS.leafPassConcurrency),
    compactionModels: file.compactionModels ?? DEFAULTS.compactionModels,
    debugMode: envBool("LCM_DEBUG") ?? file.debugMode ?? DEFAULTS.debugMode,
  };
}
