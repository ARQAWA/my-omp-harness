import { resolve } from "node:path";

// Files that a write or edit call is changing right now, shared by both tools across the process.
const fileLocks = Symbol.for("my-omp-harness.fileLocks");
const lockStore = globalThis as unknown as Record<symbol, Set<string> | undefined>;
export const inFlight = (lockStore[fileLocks] ??= new Set<string>());

/** Lock key of a path: internal URLs as given, files as absolute paths (case-folded on Windows). */
export function lockKey(path: string, cwd: string): string {
	if (path.includes("://")) return path;
	const absolute = resolve(cwd, path);
	return process.platform === "win32" ? absolute.toLowerCase() : absolute;
}
