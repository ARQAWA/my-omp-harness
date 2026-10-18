// Workspace search for grep and glob on omp's Rust search engine (@oh-my-pi/pi-natives grep and glob), inside the omp
// process: argument mapping, result grouping, newest-first ordering, and the path errors.
import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { FileType, GrepOutputMode, glob as nativeGlob, grep as nativeGrep, type GrepMatch } from "@oh-my-pi/pi-natives";
import { isInsideWorkspaceRoot, resolvePath, resolveRealPathStrict } from "../paths.ts";
import type { ContentMatch, FileMatch, OutputMode, SearchSuccess, SearchUnion } from "./format.ts";

export interface SearchRequest {
	pattern: string;
	path?: string;
	glob?: string;
	type?: string;
	outputMode: OutputMode;
	caseInsensitive: boolean;
	multiline: boolean;
	contextBefore?: number;
	contextAfter?: number;
	context?: number;
}

const MAX_INT32 = 2_147_483_647;
const MIN_INT32 = -2_147_483_648;
const SORT_STAT_TIMEOUT_MS = 2000;
// Safety cap on collected matches; the model-facing cut is the character budget in format.ts.
const HARD_MAX_MATCHES = 100_000;
const SEARCH_TIMEOUT_MS = 25_000;
const MAX_COLUMNS = 1000;

function clampInt32(value: number): number {
	if (Number.isNaN(value)) return 0;
	return Math.min(Math.max(value, MIN_INT32), MAX_INT32);
}

// A regex parse error names the pattern and, for unbalanced brackets, the escape hint.
export function classifyRipgrepMessage(message: string, pattern?: string): string {
	if (!message.toLowerCase().includes("regex parse error") || pattern === undefined) return message;
	const reason = /^error: (.+)$/m.exec(message)?.[1];
	if (reason === undefined) return message;
	const described = `rg: regex parse error: invalid regex "${pattern}": ${reason}.`;
	if (!/unclosed|unopened|repetition operator missing expression/.test(reason)) return described;
	return `${described} Escape special characters such as ( [ { with a backslash to match them literally.`;
}

// Search target: "." for the workspace root, a relative path inside it, or the absolute path outside.
function searchTargetFor(rawPath: string | undefined, cwd: string): string {
	if (!rawPath) return ".";
	const target = resolvePath(rawPath, cwd);
	if (!isInsideWorkspaceRoot(target, resolve(cwd))) return target;
	return relative(cwd, target) || ".";
}

function isRootIndependentSearchPath(path: string): boolean {
	return isAbsolute(path) || /^~(?=$|[/\\])/.test(path) || path.startsWith("file://");
}

// Newest mtime first, ties by path; keeps the input order when the stats take too long.
async function sortNewestFirst<T>(items: T[], pathOf: (item: T) => string): Promise<T[]> {
	const keyed = Promise.all(
		items.map(async (item) => {
			const path = pathOf(item);
			const mtimeMs = await stat(path).then((s) => s.mtimeMs, () => 0);
			return { item, path, mtimeMs };
		}),
	);
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timedOut = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new Error("stat timed out")), SORT_STAT_TIMEOUT_MS);
	});
	try {
		const entries = await Promise.race([keyed, timedOut]);
		entries.sort((a, b) => b.mtimeMs - a.mtimeMs || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
		return entries.map((entry) => entry.item);
	} catch {
		return items;
	} finally {
		clearTimeout(timer);
	}
}

// A glob without a slash matches the base name at any depth, as ripgrep's --iglob does.
function anyDepth(pattern: string): string {
	return pattern.includes("/") || pattern.startsWith("**") ? pattern : `**/${pattern}`;
}

// The native engine has no negated globs: a leading "!" becomes a filter applied to paths relative to the search base.
function splitGlob(glob: string | undefined): { include?: string; exclude?: Bun.Glob } {
	if (!glob) return {};
	if (glob.startsWith("!")) return { exclude: new Bun.Glob(anyDepth(glob.slice(1))) };
	return { include: glob };
}

// Groups content matches by file, merging context lines and keeping a match over a context line on the same line.
function groupContent(matches: GrepMatch[], display: (path: string) => string): { files: FileMatch[]; totalLines: number } {
	const byFile = new Map<string, Map<number, ContentMatch>>();
	for (const m of matches) {
		const file = display(m.path);
		let lines = byFile.get(file);
		if (lines === undefined) {
			lines = new Map();
			byFile.set(file, lines);
		}
		for (const c of [...(m.contextBefore ?? []), ...(m.contextAfter ?? [])]) {
			if (!lines.has(c.lineNumber)) lines.set(c.lineNumber, { lineNumber: c.lineNumber, content: c.line, isContextLine: true });
		}
		lines.set(m.lineNumber, { lineNumber: m.lineNumber, content: m.line, isContextLine: false });
	}
	let totalLines = 0;
	const files: FileMatch[] = [];
	for (const [file, lines] of byFile) {
		totalLines += lines.size;
		files.push({ file, matches: [...lines.values()].sort((a, b) => a.lineNumber - b.lineNumber) });
	}
	return { files, totalLines };
}

export async function searchWorkspace(request: SearchRequest, cwd: string, signal?: AbortSignal): Promise<SearchSuccess> {
	const rawPath = request.path === "" ? undefined : request.path;
	const rgTarget = searchTargetFor(rawPath, cwd);
	let outsideTarget: string | undefined;
	try {
		if (rawPath !== undefined) {
			const target = resolvePath(rawPath, cwd);
			const real = await resolveRealPathStrict(target);
			if (real === null) throw new Error(`Path '${rawPath}' could not be verified while resolving symlinks. This can happen when access is denied or the path contains a symlink loop.`);
			if (!isInsideWorkspaceRoot(target, resolve(cwd))) outsideTarget = target;
		}
		if (!existsSync(cwd)) throw new Error(`Path does not exist: ${cwd}`);
		const base = resolve(cwd, rgTarget);
		// Paths inside the workspace print relative to it; a search outside the workspace prints absolute paths.
		const absoluteOf = (path: string): string => (isAbsolute(path) ? path : resolve(base, path));
		const display = (path: string): string => (isAbsolute(rgTarget) ? absoluteOf(path) : relative(cwd, absoluteOf(path)));
		const { include, exclude } = splitGlob(request.glob);
		const kept = (path: string): boolean => exclude === undefined || !exclude.match(relative(base, absoluteOf(path)));
		const newestFirst = <T>(items: T[], pathOf: (item: T) => string) => sortNewestFirst(items, (item) => resolve(cwd, pathOf(item)));

		let union: SearchUnion;
		if (request.outputMode === "files_with_matches" && request.pattern === "" && include !== undefined) {
			// Listing files by glob (the Glob tool): the native walker, newest first.
			const listed = await nativeGlob({
				pattern: anyDepth(include),
				path: base,
				fileType: FileType.File,
				hidden: true,
				gitignore: true,
				sortByMtime: true,
				timeoutMs: SEARCH_TIMEOUT_MS,
				signal,
			});
			const files = listed.matches.map((m) => display(m.path));
			union = { mode: "files_with_matches", value: { files, totalFiles: clampInt32(files.length), clientTruncated: false, ripgrepTruncated: false } };
		} else {
			const both = request.context !== undefined && request.contextBefore === undefined && request.contextAfter === undefined;
			const content = request.outputMode === "content";
			const result = await nativeGrep({
				pattern: request.pattern,
				path: base,
				glob: include,
				type: request.type,
				ignoreCase: request.caseInsensitive,
				multiline: request.multiline,
				hidden: true,
				gitignore: true,
				...(content
					? { contextBefore: both ? request.context : request.contextBefore, contextAfter: both ? request.context : request.contextAfter }
					: {}),
				maxColumns: MAX_COLUMNS,
				mode: content ? GrepOutputMode.Content : request.outputMode === "count" ? GrepOutputMode.Count : GrepOutputMode.FilesWithMatches,
				maxCount: HARD_MAX_MATCHES,
				timeoutMs: SEARCH_TIMEOUT_MS,
				signal,
			});
			const matches = result.matches.filter((m) => kept(m.path));
			const truncated = result.limitReached === true;
			if (content) {
				const grouped = groupContent(matches, display);
				union = {
					mode: "content",
					value: {
						matches: await newestFirst(grouped.files, (entry) => entry.file),
						totalLines: clampInt32(grouped.totalLines),
						totalMatchedLines: clampInt32(exclude === undefined ? result.totalMatches : matches.length),
						clientTruncated: false,
						ripgrepTruncated: truncated,
					},
				};
			} else if (request.outputMode === "files_with_matches") {
				const files = await newestFirst(matches.map((m) => display(m.path)), (file) => file);
				union = { mode: "files_with_matches", value: { files, totalFiles: clampInt32(files.length), clientTruncated: false, ripgrepTruncated: truncated } };
			} else {
				const counts = await newestFirst(
					matches.map((m) => ({ file: display(m.path), count: m.matchCount ?? 0 })),
					(entry) => entry.file,
				);
				union = {
					mode: "count",
					value: {
						counts,
						totalFiles: clampInt32(counts.length),
						totalMatches: clampInt32(counts.reduce((sum, entry) => sum + entry.count, 0)),
						clientTruncated: false,
						ripgrepTruncated: truncated,
					},
				};
			}
		}
		const displayPath = outsideTarget ?? (rawPath !== undefined && isRootIndependentSearchPath(rawPath) ? resolvePath(rawPath) : rawPath);
		return { pattern: request.pattern, path: displayPath, root: cwd, union };
	} catch (error) {
		if (rawPath !== undefined) {
			const resolved = resolvePath(rawPath, cwd);
			try {
				await stat(resolved);
			} catch {
				throw new Error(`Path does not exist: ${resolved}`);
			}
		}
		throw error;
	}
}
