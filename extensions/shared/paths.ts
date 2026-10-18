// Path helpers shared by read, grep and glob.
import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** Expands ~ and file:// and resolves the path against base unless it is absolute. */
export function resolvePath(path: string, base?: string): string {
	const plain = path.startsWith("file://") ? fileURLToPath(path) : path;
	const expanded = plain.replace(/^~(?=$|\/|\\)/, homedir());
	if (base !== undefined && !isAbsolute(expanded)) return resolve(base, expanded);
	return resolve(expanded);
}

/** Realpath of the longest existing ancestor with the rest appended; null when a non-ENOENT error stops the walk. */
export async function resolveRealPathStrict(path: string): Promise<string | null> {
	const tail: string[] = [];
	let current = resolve(path);
	for (;;) {
		try {
			return join(await realpath(current), ...tail.reverse());
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") return null;
			const parent = dirname(current);
			if (parent === current) return null;
			tail.push(basename(current));
			current = parent;
		}
	}
}

/** Workspace roots compare case-insensitively on darwin and win32. */
export function isInsideWorkspaceRoot(target: string, root: string): boolean {
	const caseInsensitive = process.platform === "win32" || process.platform === "darwin";
	const t = caseInsensitive ? target.toLowerCase() : target;
	const r = caseInsensitive ? root.toLowerCase() : root;
	if (t === r) return true;
	return t.startsWith(r.endsWith(sep) ? r : r + sep);
}
