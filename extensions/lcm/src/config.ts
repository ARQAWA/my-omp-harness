/**
 * Configuration resolution: env vars > settings.json (project > global) > defaults
 */

import { resolve, normalize } from "path";
import { readFileSync } from "fs";
import { getReadableGlobalSettingsPath, loadSettings, LCM_DIR } from "./settings.js";

export interface LcmConfig {
  enabled: boolean;
  dbDir: string;
  leafChunkTokens: number;
  condensationThreshold: number;
  maxDepth: number;
  maxSummaryTokens: number;
  leafPassConcurrency: number;
  debugMode: boolean;
}

const DEFAULTS: LcmConfig = {
  enabled: true,
  dbDir: LCM_DIR,
  leafChunkTokens: 30000,
  condensationThreshold: 6,
  maxDepth: 5,
  maxSummaryTokens: 12000,
  leafPassConcurrency: 15,
  debugMode: false,
};

function readSettingsLcm(): Partial<LcmConfig> {
  try {
    const settingsPath = getReadableGlobalSettingsPath();
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

/** Validate dbDir doesn't allow path traversal. */
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
    leafPassConcurrency: Math.max(1, envInt("LCM_LEAF_CONCURRENCY") ?? file.leafPassConcurrency ?? DEFAULTS.leafPassConcurrency),
    debugMode: envBool("LCM_DEBUG") ?? file.debugMode ?? DEFAULTS.debugMode,
  };
}
