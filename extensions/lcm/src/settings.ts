/**
 * Settings persistence: load/save LCM config from settings.json (global: ~/.omp/lcm/settings.json, read from the legacy lcm/settings.json next to the omp executable while the new file is missing; project: <cwd>/.omp/lcm/settings.json).
 * Order: project > global > defaults.
 * Atomic writes via temp file + rename.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { LcmConfig } from "./config.js";

export const SETTINGS_KEY = "lcm";

/** LCM home: database files, costs.jsonl and global settings. */
export const LCM_DIR = path.join(os.homedir(), ".omp", "lcm");
/** Legacy LCM home next to the omp executable; read for migration only, never modified. */
export const LEGACY_LCM_DIR = path.join(path.dirname(process.execPath), "lcm");

export type SettingsScope = "global" | "project";
export type ConfigSource = SettingsScope | "default";

export interface LoadedConfig {
  config: Partial<LcmConfig>;
  source: ConfigSource;
  globalPath: string;
  projectPath: string;
}

function readJsonFile(filePath: string): Record<string, unknown> {
  try {
    if (!fs.existsSync(filePath)) return {};
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return {};
  }
}

export function getGlobalSettingsPath(): string {
  return path.join(LCM_DIR, "settings.json");
}

/** Global settings to read: the new file, or the legacy one while the new file is missing. */
export function getReadableGlobalSettingsPath(): string {
  const legacy = path.join(LEGACY_LCM_DIR, "settings.json");
  return !fs.existsSync(getGlobalSettingsPath()) && fs.existsSync(legacy) ? legacy : getGlobalSettingsPath();
}

export function getProjectSettingsPath(cwd: string): string {
  return path.join(cwd, ".omp", "lcm", "settings.json");
}

export function loadSettings(cwd: string): LoadedConfig {
  const globalPath = getGlobalSettingsPath();
  const projectPath = getProjectSettingsPath(cwd);

  const projectRaw = readJsonFile(projectPath)[SETTINGS_KEY];
  if (projectRaw && typeof projectRaw === "object") {
    return { config: projectRaw as Partial<LcmConfig>, source: "project", globalPath, projectPath };
  }

  const globalRaw = readJsonFile(getReadableGlobalSettingsPath())[SETTINGS_KEY];
  if (globalRaw && typeof globalRaw === "object") {
    return { config: globalRaw as Partial<LcmConfig>, source: "global", globalPath, projectPath };
  }

  return { config: {}, source: "default", globalPath, projectPath };
}

export function saveSettings(
  config: Partial<LcmConfig>,
  scope: SettingsScope,
  cwd: string,
): string {
  const settingsPath = scope === "project"
    ? getProjectSettingsPath(cwd)
    : getGlobalSettingsPath();

  const settings = readJsonFile(scope === "project" ? settingsPath : getReadableGlobalSettingsPath());
  const existing = settings[SETTINGS_KEY];
  settings[SETTINGS_KEY] = existing && typeof existing === "object" && !Array.isArray(existing)
    ? { ...(existing as Record<string, unknown>), ...config }
    : config;

  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });

  // Atomic write: temp + rename prevents corruption
  const tmpPath = `${settingsPath}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(settings, null, 2) + "\n");
    fs.renameSync(tmpPath, settingsPath);
  } finally {
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch {}
  }

  return settingsPath;
}
