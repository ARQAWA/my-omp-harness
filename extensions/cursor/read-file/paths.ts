import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Cursor's resolvePath: strips a file:// prefix, expands a leading ~, and resolves a relative path against the workspace.
export function resolveReadPath(path: string, workspace: string): string {
	const untildified = untildify(stripFileUrl(path));
	return isAbsolute(untildified) ? resolve(untildified) : resolve(workspace, untildified);
}

function stripFileUrl(path: string): string {
	if (!path.startsWith("file://")) return path;
	try {
		return fileURLToPath(path);
	} catch {
		return path;
	}
}

function untildify(path: string): string {
	return path.replace(/^~(?=$|\/|\\)/, homedir());
}

// Cursor's resolveRealPathStrict: the real path of the longest existing ancestor, with the missing tail appended.
// null means an ancestor could not be resolved for a reason other than ENOENT.
export async function resolveRealPath(path: string): Promise<string | null> {
	const normalized = resolve(path);
	let current = normalized;
	for (;;) {
		try {
			return resolve(await realpath(current), relative(current, normalized));
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") return null;
			const parent = dirname(current);
			if (parent === current) return normalized;
			current = parent;
		}
	}
}
