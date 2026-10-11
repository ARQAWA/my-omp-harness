import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { glob, grep } from "@oh-my-pi/pi-natives";
import type { Component } from "@oh-my-pi/pi-tui";
import { type ToolRenderer, toolRenderers } from "@oh-my-pi/pi-tui/tools";
import { closeSync, openSync, readdirSync, readFileSync, readSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";

const TYPE_EXTENSIONS: Record<string, string[]> = {
	js: [".js", ".mjs", ".cjs", ".jsx"],
	ts: [".ts", ".tsx", ".mts", ".cts"],
	py: [".py", ".pyi"],
	rust: [".rs"],
	go: [".go"],
	java: [".java"],
	c: [".c", ".h"],
	cpp: [".cpp", ".cc", ".cxx", ".hpp", ".hh", ".hxx", ".h"],
	md: [".md", ".markdown"],
	json: [".json", ".jsonc"],
	yaml: [".yml", ".yaml"],
	toml: [".toml"],
	sh: [".sh", ".bash", ".zsh"],
	ruby: [".rb"],
	php: [".php"],
	swift: [".swift"],
	kotlin: [".kt", ".kts"],
	html: [".html", ".htm"],
	css: [".css", ".scss", ".sass", ".less"],
	sql: [".sql"],
	xml: [".xml"],
	csharp: [".cs"],
	scala: [".scala"],
	lua: [".lua"],
	dart: [".dart"],
	r: [".r"],
	vue: [".vue"],
	svelte: [".svelte"],
	proto: [".proto"],
	graphql: [".graphql", ".gql"],
};

const RESULT_MAX_CHARS = 100_000;
const READ_RESERVE = 300;
const FOOTER_RESERVE = 300;
const MAX_COLUMNS = RESULT_MAX_CHARS;

const READ_SKIP_EXTENSIONS = new Set([
	".pdf",
	".ipynb",
	".docx",
	".xlsx",
	".pptx",
	".png",
	".jpg",
	".jpeg",
	".gif",
	".webp",
	".svg",
	".svgz",
	".db",
	".sqlite",
	".zip",
	".tar",
	".gz",
	".tgz",
	".7z",
	".rar",
]);

type GrepMatch = {
	path: string;
	lineNumber: number;
	line: string;
	matchCount?: number;
	contextBefore?: { lineNumber: number; line: string }[];
	contextAfter?: { lineNumber: number; line: string }[];
};

type MatchGroup = { line: number; entries: { lineNumber: number; line: string }[] };
type SearchFile = { path: string; abs: string; count: number; groups: MatchGroup[] };

type SearchMode = "content" | "filesWithMatches" | "count" | "files";

function pathMatchesType(filePath: string, type: string): boolean {
	const exts = Object.prototype.hasOwnProperty.call(TYPE_EXTENSIONS, type) ? TYPE_EXTENSIONS[type] : undefined;
	if (!exts) return false;
	const lower = filePath.toLowerCase();
	return exts.some(ext => lower.endsWith(ext));
}

function displayPath(matchPath: string): string {
	return matchPath.split(/[/\\]/).join("/");
}

function isDirectory(p: string): boolean {
	try {
		return statSync(p).isDirectory();
	} catch {
		return false;
	}
}

function isRegularFile(p: string): boolean {
	try {
		return statSync(p).isFile();
	} catch {
		return false;
	}
}

function pathExists(p: string): boolean {
	try {
		return statSync(p, { throwIfNoEntry: false }) !== undefined;
	} catch {
		return false;
	}
}

function normalizeInputPath(raw: string): string {
	if (raw.includes("://")) return raw;
	let s = raw.trim();
	if (s.length >= 2 && (s[0] === '"' || s[0] === "'") && s[s.length - 1] === s[0]) s = s.slice(1, -1).trim();
	s = s.replace(/\\/g, "/");
	if (s === "~" || s.startsWith("~/")) s = homedir().replace(/\\/g, "/") + s.slice(1);
	if (process.platform === "win32") {
		const drive = s.match(/^\/([a-zA-Z])(\/.*)?$/);
		if (drive) s = `${drive[1]!.toUpperCase()}:${drive[2] ?? "/"}`;
		s = s.replace(/^([a-z]):/, (_m, d: string) => `${d.toUpperCase()}:`);
	}
	return s;
}

function editDistance(a: string, b: string): number {
	let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
	for (let i = 1; i <= a.length; i++) {
		const cur: number[] = [i];
		for (let j = 1; j <= b.length; j++) {
			cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
		}
		prev = cur;
	}
	return prev[b.length]!;
}

function missingPathText(abs: string): string {
	let child = abs;
	let anc = dirname(abs);
	while (!isDirectory(anc) && dirname(anc) !== anc) {
		child = anc;
		anc = dirname(anc);
	}
	let names: string[] = [];
	try {
		names = readdirSync(anc);
	} catch {
		names = [];
	}
	const segment = basename(child).toLowerCase();
	const similar = names
		.map(name => ({ name, d: editDistance(name.toLowerCase(), segment) }))
		.sort((a, b) => a.d - b.d || a.name.localeCompare(b.name))
		.slice(0, 5)
		.map(x => x.name);
	return `Path not found: ${abs}. Nearest existing directory: ${anc}. Similar names there: ${similar.length > 0 ? similar.join(", ") : "none"}.`;
}

function errorResult(text: string) {
	return { content: [{ type: "text" as const, text }], isError: true as const };
}

type HookFields = Record<string, unknown>;

function hookFields(value: unknown): HookFields {
	if (typeof value === "object" && value !== null) {
		return value as HookFields;
	}
	return {};
}

function textOf(content: unknown): string {
	if (!Array.isArray(content)) return "";
	return content
		.map(c => {
			const o = hookFields(c);
			return o.type === "text" && typeof o.text === "string" ? o.text : "";
		})
		.filter(t => t !== "")
		.join("\n");
}

function resultText(r: unknown): string {
	if (typeof r !== "object" || r === null || !("content" in r)) return "";
	return textOf(r.content);
}

function isGrepMatch(value: unknown): value is GrepMatch {
	if (typeof value !== "object" || value === null) return false;
	if (!("path" in value) || !("lineNumber" in value) || !("line" in value)) return false;
	const { path, lineNumber, line } = value;
	return typeof path === "string" && typeof lineNumber === "number" && typeof line === "string";
}

function grepMatchesFrom(result: { matches: unknown }): GrepMatch[] {
	if (!Array.isArray(result.matches)) return [];
	return result.matches.filter(isGrepMatch);
}

function globNativePaths(result: unknown): string[] {
	if (Array.isArray(result)) return result.filter((p): p is string => typeof p === "string");
	if (typeof result === "object" && result !== null) {
		if ("paths" in result) {
			const paths = result.paths;
			if (Array.isArray(paths)) return paths.filter((p): p is string => typeof p === "string");
		}
		if ("matches" in result) {
			const matches = result.matches;
			if (!Array.isArray(matches)) return [];
			const out: string[] = [];
			for (const m of matches) {
				if (typeof m === "object" && m !== null && "path" in m && typeof m.path === "string") {
					out.push(m.path);
				}
			}
			return out;
		}
	}
	return [];
}

function mtimeOf(abs: string): number {
	try {
		return statSync(abs).mtimeMs;
	} catch {
		return 0;
	}
}

function cutLongLine(line: string, p: string, n: number): string {
	return line.length > MAX_COLUMNS
		? `${line.slice(0, MAX_COLUMNS)} [... omitted end of long line; read path=${p}:${n}:chars:${MAX_COLUMNS}+${RESULT_MAX_CHARS}]`
		: line;
}

function withoutGit(rel: string): boolean {
	return !(rel === ".git" || rel.startsWith(".git/") || rel.includes("/.git/"));
}

function ensureDoubleStar(globPattern: string): string {
	return globPattern.startsWith("**/") ? globPattern : `**/${globPattern}`;
}

async function runSearch(opts: {
	cwd: string;
	base: string;
	glob?: string;
	exclude?: string;
	pattern: string;
	mode: SearchMode;
	ignoreCase?: boolean;
	before?: number;
	after?: number;
	multiline?: boolean;
	type?: string;
	signal?: AbortSignal;
}): Promise<SearchFile[]> {
	const nativeGlob = opts.glob ? ensureDoubleStar(opts.glob) : undefined;
	const excluded = opts.exclude !== undefined ? new Bun.Glob(ensureDoubleStar(opts.exclude)) : undefined;
	const nativeMode = opts.mode === "files" ? "filesWithMatches" : opts.mode;
	const result = await grep({
		pattern: opts.pattern,
		path: opts.base,
		glob: nativeGlob,
		ignoreCase: opts.ignoreCase,
		multiline: opts.multiline,
		hidden: true,
		gitignore: true,
		...(opts.mode === "content" ? { contextBefore: opts.before, contextAfter: opts.after } : {}),
		maxColumns: MAX_COLUMNS,
		mode: nativeMode,
		maxCount: 100000,
		timeoutMs: 25000,
		signal: opts.signal,
	});

	const byPath = new Map<string, { abs: string; matches: GrepMatch[]; count: number }>();
	for (const m of grepMatchesFrom(result)) {
		const abs = resolve(opts.base, m.path);
		const rel = displayPath(relative(opts.cwd, abs));
		if (!withoutGit(rel)) continue;
		if (excluded?.match(displayPath(relative(opts.base, abs)))) continue;
		if (opts.type !== undefined && !pathMatchesType(rel, opts.type)) continue;
		let slot = byPath.get(rel);
		if (!slot) {
			slot = { abs, matches: [], count: 0 };
			byPath.set(rel, slot);
		}
		if (opts.mode === "count") slot.count += m.matchCount ?? 0;
		else if (opts.mode === "content") slot.matches.push(m);
	}

	const files: { rel: string; abs: string; mtime: number; index: number }[] = [];
	let index = 0;
	for (const [rel, slot] of byPath) {
		files.push({ rel, abs: slot.abs, mtime: mtimeOf(slot.abs), index: index++ });
	}
	files.sort((a, b) => b.mtime - a.mtime || a.index - b.index);

	return files.map(f => {
		const slot = byPath.get(f.rel)!;
		const seen = new Set<number>();
		const groups: MatchGroup[] = [];
		for (const m of [...slot.matches].sort((a, b) => a.lineNumber - b.lineNumber)) {
			if (seen.has(m.lineNumber)) continue;
			seen.add(m.lineNumber);
			groups.push({
				line: m.lineNumber,
				entries: [
					{ lineNumber: m.lineNumber, line: m.line },
					...(m.contextBefore ?? []).map(c => ({ lineNumber: c.lineNumber, line: c.line })),
					...(m.contextAfter ?? []).map(c => ({ lineNumber: c.lineNumber, line: c.line })),
				],
			});
		}
		return { path: f.rel, abs: f.abs, count: slot.count, groups };
	});
}

function renderContent(
	files: SearchFile[],
	offset: number,
	limit: number,
	budget: number,
): { lines: string[]; taken: number } {
	const out: string[] = [];
	let used = 0;
	let taken = 0;
	let skip = offset;
	outer: for (const f of files) {
		const p = f.path === ".." || f.path.startsWith("../") ? displayPath(f.abs) : f.path;
		const matchLines = new Set(f.groups.map(g => g.line));
		const shown = new Set<number>();
		let last = 0;
		for (const g of f.groups) {
			if (skip > 0) {
				skip--;
				continue;
			}
			if (taken >= limit) break outer;
			const add: string[] = [];
			const fresh: number[] = [];
			let prev = last;
			for (const e of [...g.entries].sort((a, b) => a.lineNumber - b.lineNumber)) {
				if (shown.has(e.lineNumber) || fresh.includes(e.lineNumber)) continue;
				if (prev > 0 && e.lineNumber > prev + 1) add.push("--");
				const sep = matchLines.has(e.lineNumber) ? ":" : "-";
				add.push(`${p}${sep}${e.lineNumber}${sep}${cutLongLine(e.line, p, e.lineNumber)}`);
				fresh.push(e.lineNumber);
				prev = e.lineNumber;
			}
			const cost = add.reduce((n, l) => n + l.length + 1, 0);
			if (used + cost > budget) {
				if (taken === 0) {
					for (const l of add) {
						const room = budget - used;
						if (room <= 0) break;
						const piece = l.slice(0, room);
						out.push(piece);
						used += piece.length + 1;
					}
					taken = 1;
				}
				break outer;
			}
			out.push(...add);
			used += cost;
			for (const n of fresh) shown.add(n);
			last = prev;
			taken++;
		}
	}
	return { lines: out, taken };
}

function renderRows(
	rows: string[],
	offset: number,
	limit: number,
	budget: number,
): { lines: string[]; taken: number } {
	const out: string[] = [];
	let used = 0;
	for (let i = offset; i < rows.length && out.length < limit; i++) {
		const row = rows[i]!;
		if (out.length > 0 && used + row.length + 1 > budget) break;
		out.push(row);
		used += row.length + 1;
	}
	return { lines: out, taken: out.length };
}

function splitFileLines(text: string): string[] {
	let body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
	if (body === "") return [];
	const lines = body.split("\n").map(l => (l.endsWith("\r") ? l.slice(0, -1) : l));
	if (lines[lines.length - 1] === "") lines.pop();
	return lines;
}

type ReadSel =
	| { start: number; limit?: number; offsetNeg?: number }
	| { line: number; charStart: number; charCount: number };
type ReadResult = { text: string; details: Record<string, unknown>; error?: boolean };

function readFits(text: string): boolean {
	return text.length <= RESULT_MAX_CHARS - READ_RESERVE;
}

function readDetails(text: string, total: number, fileSize: number, outputLines: number, truncated: boolean) {
	return {
		truncation: {
			truncated,
			truncatedBy: truncated ? "chars" : null,
			totalLines: total,
			totalBytes: fileSize,
			outputLines,
			outputBytes: Buffer.byteLength(text, "utf8"),
			lastLinePartial: false,
			firstLineExceedsLimit: false,
		},
		totalLines: total,
		fileSize,
	};
}

function readFragment(
	lines: string[],
	fileSize: number,
	pathLabel: string,
	line: number,
	charStart: number,
	charCount: number,
): ReadResult {
	const total = lines.length;
	if (line < 1 || line > total) return { text: `Error: line ${line} ${line > total ? "is past the end" : "is before the first line"}; the file has ${total} lines (use a line from 1 to ${total})`, details: {}, error: true };
	const s = lines[line - 1]!;
	if (charStart >= s.length && s.length > 0) return { text: `Error: char offset ${charStart} is past the end of line ${line}; the line has ${s.length} characters (use an offset from 0 to ${s.length - 1})`, details: {}, error: true };
	const prefix = charStart === 0 && total >= 10 && line % 10 === 0 ? `${String(line).padStart(6)}|` : "";
	const trailer = (n: number): string =>
		charStart + n < s.length
			? `\n[Use path=${pathLabel}:${line}:chars:${charStart + n}+${n} to continue]`
			: line < total
				? `\n[Use offset=${line + 1} to continue]`
				: "";
	const render = (n: number): string => prefix + s.slice(charStart, charStart + n) + trailer(n);
	const want = Math.max(0, Math.min(Math.max(1, charCount), s.length - charStart));
	let lo = Math.min(1, want);
	let hi = want;
	while (lo < hi) {
		const mid = Math.ceil((lo + hi) / 2);
		if (readFits(render(mid))) lo = mid;
		else hi = mid - 1;
	}
	let n = lo;
	if (n > 0 && charStart + n < s.length) {
		const code = s.charCodeAt(charStart + n - 1);
		if (code >= 0xd800 && code <= 0xdbff) n = n > 1 ? n - 1 : 2;
	}
	const text = render(n);
	return { text, details: readDetails(text, total, fileSize, 1, n < want) };
}

function readLocalText(abs: string, pathLabel: string, sel: ReadSel): ReadResult {
	const text = readFileSync(abs, "utf8");
	return readTextBody(text, statSync(abs).size, pathLabel, sel);
}

function readTextBody(text: string, fileSize: number, pathLabel: string, sel: ReadSel): ReadResult {
	const lines = splitFileLines(text);
	const total = lines.length;
	if (total === 0) {
		const text = "File is empty.";
		return { text, details: readDetails(text, 0, fileSize, 0, false) };
	}
	if ("line" in sel) return readFragment(lines, fileSize, pathLabel, sel.line, sel.charStart, sel.charCount);

	let start = 1;
	let end = total;
	if (sel.offsetNeg !== undefined) {
		start = Math.max(1, total - sel.offsetNeg + 1);
		end = sel.limit !== undefined ? Math.min(total, start + sel.limit - 1) : total;
	} else {
		if (sel.start >= 1 && sel.start <= total) start = sel.start;
		if (sel.limit !== undefined) end = Math.min(total, start + sel.limit - 1);
	}

	const shown: string[] = [];
	let chars = 0;
	for (let n = start; n <= end; n++) {
		const body = lines[n - 1]!;
		const text = total >= 10 && n % 10 === 0 ? `${String(n).padStart(6)}|${body}` : body;
		const sep = shown.length > 0 ? 1 : 0;
		if (chars + sep + text.length > RESULT_MAX_CHARS - READ_RESERVE) break;
		chars += sep + text.length;
		shown.push(text);
	}
	if (shown.length === 0 && start <= end) return readFragment(lines, fileSize, pathLabel, start, 0, Number.MAX_SAFE_INTEGER);

	const fit = start - 1 + shown.length;
	const out: string[] = [];
	if (start > 1) out.push(`... ${start - 1} lines not shown ...`, `[Use offset=1 limit=${start - 1} to read them]`);
	out.push(...shown);
	if (fit < end) {
		out.push(`... ${total - fit} lines not shown ...`, `[Use offset=${fit + 1} to continue]`);
	} else if (end < total) {
		out.push(`... ${total - end} lines not shown ...`, `[Use offset=${end + 1} to continue]`);
	}
	const result = out.join("\n");
	return { text: result, details: readDetails(result, total, fileSize, shown.length, fit < end) };
}

type TreeNode = { dirs: Map<string, TreeNode>; files: string[] };

function buildTree(paths: string[]): TreeNode {
	const root: TreeNode = { dirs: new Map(), files: [] };
	for (const p of paths) {
		const parts = p.split("/");
		let node = root;
		for (let i = 0; i < parts.length - 1; i++) {
			let next = node.dirs.get(parts[i]!);
			if (!next) {
				next = { dirs: new Map(), files: [] };
				node.dirs.set(parts[i]!, next);
			}
			node = next;
		}
		node.files.push(parts[parts.length - 1]!);
	}
	return root;
}

function treeFileCount(node: TreeNode): number {
	let n = node.files.length;
	for (const d of node.dirs.values()) n += treeFileCount(d);
	return n;
}

function treeExtensionCounts(node: TreeNode, counts: Map<string, number>): void {
	for (const f of node.files) {
		const dot = f.lastIndexOf(".");
		const ext = dot > 0 ? f.slice(dot) : "(none)";
		counts.set(ext, (counts.get(ext) ?? 0) + 1);
	}
	for (const d of node.dirs.values()) treeExtensionCounts(d, counts);
}

type TreeEntry = { depth: number; name: string; dir: boolean; rel: string; unexpanded?: string; skipped?: number };

function walkTree(node: TreeNode, depth: number, budget: { left: number }, out: TreeEntry[], prefix = ""): void {
	const names: { name: string; dir: boolean }[] = [
		...[...node.dirs.keys()].map(name => ({ name, dir: true })),
		...node.files.map(name => ({ name, dir: false })),
	].sort((a, b) => a.name.localeCompare(b.name));
	let skipped = 0;
	for (const item of names) {
		const rel = `${prefix}${item.name}`;
		if (!item.dir) {
			if (budget.left <= 0) {
				skipped++;
				continue;
			}
			budget.left -= item.name.length;
			out.push({ depth, name: item.name, dir: false, rel });
			continue;
		}
		const child = node.dirs.get(item.name)!;
		if (budget.left <= 0) {
			const counts = new Map<string, number>();
			treeExtensionCounts(child, counts);
			const byCount = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([ext, n]) => `${n} ${ext}`);
			out.push({
				depth,
				name: item.name,
				dir: true,
				rel,
				unexpanded: `[${treeFileCount(child)} files: ${byCount.join(", ")}]`,
			});
			continue;
		}
		budget.left -= item.name.length;
		out.push({ depth, name: item.name, dir: true, rel });
		walkTree(child, depth + 1, budget, out, `${rel}/`);
	}
	if (skipped > 0) out.push({ depth, name: "", dir: false, rel: prefix.replace(/\/$/, ""), skipped });
}

export async function directoryTreeEntries(dir: string, signal?: AbortSignal): Promise<TreeEntry[]> {
	const result = await glob({ pattern: "**/*", path: dir, hidden: true, gitignore: true, recursive: true, signal });
	const files = globNativePaths(result)
		.map(displayPath)
		.filter(withoutGit)
		.filter(p => {
			try {
				return statSync(resolve(dir, p)).isFile();
			} catch {
				return false;
			}
		});
	const out: TreeEntry[] = [];
	walkTree(buildTree(files), 0, { left: RESULT_MAX_CHARS - dir.length }, out);
	return out;
}

function treeText(dir: string, entries: TreeEntry[]): string {
	const lines = [`${dir}/`];
	for (const e of entries) {
		const indent = "  ".repeat(e.depth + 1);
		if (e.skipped !== undefined) lines.push(`${indent}[${e.skipped} more files] (read ${dir}/${e.rel} to list them)`);
		else if (e.unexpanded) lines.push(`${indent}${e.name}/ ${e.unexpanded} (read ${dir}/${e.rel} to list them)`);
		else lines.push(`${indent}${e.name}${e.dir ? "/" : ""}`);
	}
	return lines.join("\n");
}

function hasNulInFirst8k(filePath: string): boolean {
	let fd: number | undefined;
	try {
		fd = openSync(filePath, "r");
		const buf = Buffer.alloc(8192);
		const n = readSync(fd, buf, 0, 8192, 0);
		return buf.subarray(0, n).includes(0);
	} catch {
		return true;
	} finally {
		if (fd !== undefined) closeSync(fd);
	}
}

function isArchiveMemberPath(p: string): boolean {
	return /\.(zip|tar|tgz|7z|rar)\//i.test(p);
}

function readExtensionSkip(filePath: string): boolean {
	const lower = filePath.toLowerCase();
	for (const ext of READ_SKIP_EXTENSIONS) {
		if (lower.endsWith(ext)) return true;
	}
	return false;
}

// A path the shadowed `read` handles itself: a plain local file or directory without omp selectors.
function isPlainLocalPath(p: string): boolean {
	if (p.includes("://") || p.includes(",")) return false;
	if (/:(raw|conflicts|img|\d+|-\d+)/.test(p)) return false;
	return true;
}

const URL_SELECTOR = /:(raw|conflicts|img|chars:|-?\d)/;
const NATIVE_PAGE_LINES = 3000;
const SHOWING_NOTICE = /^\[Showing lines \d+-\d+ of \d+\. Use :\d+ to continue\]$/;
const BEYOND_END = /^Line \d+ is beyond end of/;

// True when a URL path (its part after the scheme) carries an omp selector such as :raw, :3-9 or :chars:.
function urlHasSelector(p: string): boolean {
	return URL_SELECTOR.test(p.slice(p.indexOf("://") + 3));
}

function isErrorResult(r: unknown): boolean {
	return typeof r === "object" && r !== null && "isError" in r && r.isError === true;
}

function textSel(offset: number | undefined, limit: number | undefined): ReadSel {
	const lim = limit !== undefined && limit > 0 ? limit : undefined;
	const off = offset === 0 ? undefined : offset;
	return off !== undefined && off < 0 ? { start: 1, limit: lim, offsetNeg: -off } : { start: off ?? 1, limit: lim };
}

type ArtifactSource = {
	getArtifactsDir(): string;
	getSessionFile(): string | null | undefined;
};

// File holding the output of subagent `id`: <artifacts dir>/<id>.md, or the session file name without .jsonl.
function agentOutputPath(source: ArtifactSource, id: string): string | undefined {
	let dir: string | undefined;
	try {
		dir = source.getArtifactsDir();
	} catch {
		dir = undefined;
	}
	if (!dir) {
		try {
			const session = source.getSessionFile();
			dir = session ? session.replace(/\.jsonl$/, "") : undefined;
		} catch {
			dir = undefined;
		}
	}
	return dir ? join(dir, `${id}.md`) : undefined;
}

// A structured subagent result is stored as a JSON string literal or object; plain text is returned as it is.
function agentOutputText(raw: string): string {
	try {
		const value: unknown = JSON.parse(raw);
		if (typeof value === "string") return value;
		if (typeof value === "object" && value !== null) return JSON.stringify(value, null, 2);
	} catch {}
	return raw;
}

// Reads a URL through the native reader in pages of NATIVE_PAGE_LINES lines, up to limit lines and the read budget.
async function pageNative<T>(
	url: string,
	offset: number | undefined,
	limit: number | undefined,
	native: (path: string) => Promise<T>,
): Promise<T | { content: { type: "text"; text: string }[] }> {
	const first = offset !== undefined && offset > 0 ? offset : 1;
	const maxLines = limit !== undefined && limit > 0 ? limit : Number.POSITIVE_INFINITY;
	const budget = RESULT_MAX_CHARS - READ_RESERVE;
	const out: string[] = [];
	let used = 0;
	let atEnd = false;
	while (out.length < maxLines) {
		const want = Math.min(NATIVE_PAGE_LINES, maxLines - out.length);
		const from = first + out.length;
		const r = await native(`${url}:${from}-${from + want - 1}`);
		const text = resultText(r);
		if (BEYOND_END.test(text)) {
			if (out.length === 0) return r;
			atEnd = true;
			break;
		}
		if (isErrorResult(r)) {
			if (out.length === 0) return r;
			break;
		}
		const parts = text.split("\n");
		if (parts[parts.length - 1] === "") parts.pop();
		const hasNotice = parts.some(line => SHOWING_NOTICE.test(line));
		const lines = parts.filter(line => !SHOWING_NOTICE.test(line));
		if (lines.length === 0) {
			if (out.length === 0) return r;
			atEnd = true;
			break;
		}
		let cut = false;
		for (const line of lines) {
			if (out.length >= maxLines) {
				cut = true;
				break;
			}
			const cost = line.length + 1;
			if (used + cost > budget) {
				if (out.length === 0) out.push(`${line.slice(0, budget)} [... omitted end of long line ${first + out.length}; search inside it with grep path=${url}]`);
				cut = true;
				break;
			}
			out.push(line);
			used += cost;
		}
		if (cut) break;
		if (!hasNotice && lines.length < want) {
			atEnd = true;
			break;
		}
	}
	const body = out.join("\n");
	const pageText = atEnd ? body : `${body}\n[Use path=${url} offset=${first + out.length} to continue]`;
	return { content: [{ type: "text" as const, text: pageText }] };
}

/** The tool draws through omp's renderer for its name, so display extensions that patch that renderer apply to it. */
function sharedRender(name: string) {
	const host = toolRenderers[name]!;
	return {
		renderCall: (...args: Parameters<ToolRenderer["renderCall"]>) => host.renderCall(...args) as Component,
		renderResult: (...args: Parameters<ToolRenderer["renderResult"]>) => host.renderResult(...args) as Component,
	};
}

export default function rg(pi: ExtensionAPI) {
	pi.on("tool_result", async (event, ctx) => {
		try {
			if (event.toolName !== "bash" || event.isError === undefined) return;
			const details = hookFields(event.details);
			if (details.async != null && details.async !== false) return;
			const wall = details.wallTimeMs;
			if (typeof wall !== "number") return;
			const first = Array.isArray(event.content) ? event.content[0] : undefined;
			if (typeof first !== "object" || first === null || !("type" in first) || first.type !== "text") return;
			const original = "text" in first && typeof first.text === "string" ? first.text : "";
			const exitCode = typeof details.exitCode === "number" ? details.exitCode : event.isError ? 1 : 0;
			const text = [
				`Exit code: ${exitCode}`,
				"",
				"Command output:",
				"",
				"```",
				original,
				"```",
				"",
				`Command completed in ${Math.round(wall)} ms.`,
				"",
				`Shell state (cwd, env vars) persists for subsequent calls. Current directory: ${ctx.cwd}`,
			].join("\n");
			return { content: [{ type: "text", text }], details: event.details, isError: event.isError };
		} catch {
			return undefined;
		}
	});

	const z = pi.zod;
	const outputMode = z.enum(["content", "files_with_matches", "count"]);

	pi.registerTool({
		name: "grep",
		label: "grep",
		...sharedRender("grep"),
		loadMode: "essential",
		description:
			"Ripgrep search over file contents. Parameters: pattern (regex; an invalid regex is searched as literal text); path (file or directory, default working directory); glob (file glob filter; without '/' it matches the base name at any depth; a leading ! excludes the matching files); " +
			"type (language name such as ts, py, rust, go, java, ruby, php, swift, kotlin, html, css, sql, md, json, yaml); output_mode (content | files_with_matches | count, default content); " +
			"-A, -B, -C (context lines; -C fills whichever of -A/-B is absent); -i (case insensitive; search is case-sensitive by default); head_limit and offset (count matches in content mode, files in files_with_matches mode, entries in count mode); multiline. " +
			"Hidden files are searched and .gitignore is respected. Matches print as path:line:text, ready for read path:line. Files are ordered newest-modified first. " +
			"Output holds up to 100,000 characters; a cut result ends with a line giving the offset to continue. " +
			"A path with a URL scheme, such as history://, artifact:// or local://, goes to omp's native search, which uses only pattern, path and -i; path xd:// lists the tool devices whose names or summaries match the pattern.",
		parameters: z.object({
			pattern: z.string().optional(),
			path: z.string().optional(),
			glob: z.string().optional(),
			type: z.string().optional(),
			output_mode: outputMode.optional(),
			"-A": z.number().optional(),
			"-B": z.number().optional(),
			"-C": z.number().optional(),
			"-i": z.boolean().optional(),
			head_limit: z.number().optional(),
			offset: z.number().optional(),
			multiline: z.boolean().optional(),
		}),
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			if (params.type !== undefined && !Object.prototype.hasOwnProperty.call(TYPE_EXTENSIONS, params.type)) {
				return errorResult(`Unknown type "${params.type}". Accepted types: ${Object.keys(TYPE_EXTENSIONS).join(", ")}.`);
			}
			if (params.pattern === undefined || params.pattern === "") {
				return { content: [{ type: "text", text: "pattern is required" }] };
			}
			const pattern = params.pattern;
			if (params.path === "xd://") {
				const listing = resultText(await ctx.invokeTool!({ path: "xd://" }, { signal, onUpdate }));
				let matches: (line: string) => boolean;
				try {
					const re = new RegExp(pattern, "i");
					matches = line => re.test(line);
				} catch {
					const needle = pattern.toLowerCase();
					matches = line => line.toLowerCase().includes(needle);
				}
				const lines = listing.split("\n").filter(line => matches(line));
				return {
					content: [
						{
							type: "text",
							text: `<workspace_result workspace_path="${ctx.cwd}">\n${lines.length > 0 ? lines.join("\n") : "No matches found"}\n</workspace_result>`,
						},
					],
				};
			}
			if (params.path?.includes("://")) {
				return ctx.invokeTool!(
					{ pattern, path: params.path, ...(params["-i"] ? { case: false } : {}) },
					{ signal, onUpdate },
				);
			}

			const rawPath = params.path === undefined ? undefined : normalizeInputPath(params.path);
			const pathParam = rawPath === "" ? undefined : rawPath;
			const searchPath = resolve(ctx.cwd, pathParam ?? ".");
			let isFile = false;
			try {
				isFile = statSync(searchPath).isFile();
			} catch {
				return errorResult(missingPathText(searchPath));
			}
			const base = isFile ? resolve(searchPath, "..") : searchPath;
			const fileGlob = isFile ? searchPath.slice(base.length + 1) : params.glob === "" ? undefined : params.glob;
			const excludeGlob = fileGlob?.startsWith("!") ? fileGlob.slice(1) : undefined;

			const before = params["-B"] ?? params["-C"];
			const after = params["-A"] ?? params["-C"];

			const modeVal = params.output_mode ?? "content";
			const mode: SearchMode = modeVal === "files_with_matches" ? "filesWithMatches" : modeVal;
			const offset = params.offset !== undefined && params.offset > 0 ? params.offset : 0;
			const headLimit =
				params.head_limit !== undefined && Number.isFinite(params.head_limit) && params.head_limit > 0
					? params.head_limit
					: undefined;

			const searchOpts = {
				cwd: ctx.cwd,
				base,
				glob: excludeGlob === undefined ? fileGlob : undefined,
				exclude: excludeGlob,
				mode,
				ignoreCase: params["-i"],
				before,
				after,
				multiline: params.multiline,
				type: params.type,
				signal,
			};
			let note = "";
			let files: SearchFile[];
			try {
				files = await runSearch({ ...searchOpts, pattern });
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				if (!message.startsWith("regex parse error") && !message.startsWith("regex error")) throw err;
				note = `Note: "${pattern}" is not a valid regex; searched it as literal text.`;
				files = await runSearch({ ...searchOpts, pattern: pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") });
			}

			const prefix = note === "" ? "" : `${note}\n`;
			const budget = RESULT_MAX_CHARS - ctx.cwd.length - prefix.length - FOOTER_RESERVE;
			const limit = headLimit ?? Number.POSITIVE_INFINITY;
			let total: number;
			let word: string;
			let rendered: { lines: string[]; taken: number };
			if (modeVal === "content") {
				total = files.reduce((n, f) => n + f.groups.length, 0);
				word = "matches";
				rendered = renderContent(files, offset, limit, budget);
			} else {
				const rows = files.map(f => {
					const p = f.path === ".." || f.path.startsWith("../") ? displayPath(f.abs) : f.path;
					return modeVal === "count" ? `${p}:${f.count}` : p;
				});
				total = rows.length;
				word = modeVal === "count" ? "entries" : "files";
				rendered = renderRows(rows, offset, limit, budget);
			}

			if (rendered.taken === 0) {
				return {
					content: [
						{
							type: "text",
							text: `${prefix}<workspace_result workspace_path="${ctx.cwd}">\nNo matches found\n</workspace_result>`,
						},
					],
				};
			}
			const end = offset + rendered.taken;
			const body = [...rendered.lines];
			if (end < total) body.push(`[Showing ${word} ${offset + 1}-${end} of at least ${total}. Use offset=${end} to continue]`);
			return {
				content: [
					{
						type: "text",
						text: `${prefix}<workspace_result workspace_path="${ctx.cwd}">\n${body.join("\n")}\n</workspace_result>`,
					},
				],
			};
		},
	});

	pi.registerTool({
		name: "glob",
		label: "glob",
		...sharedRender("glob"),
		loadMode: "essential",
		description:
			"Find files by glob pattern, recursively. Parameters: glob_pattern (required; a pattern without a leading **/ matches at any depth; braces work); target_directory (default working directory); offset (number of files to skip, default 0). " +
			"Hidden files are included, .gitignore is respected, empty files are absent, and files are listed newest-modified first. " +
			"Output holds up to 100,000 characters; a cut list ends with a '... K more files. Use offset=N to continue.' line.",
		parameters: z.object({
			glob_pattern: z.string(),
			target_directory: z.string().optional(),
			offset: z.number().optional(),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const target = resolve(ctx.cwd, normalizeInputPath(params.target_directory ?? "."));
			if (!isDirectory(target)) {
				return errorResult(missingPathText(target));
			}
			const files = await runSearch({
				cwd: ctx.cwd,
				base: target,
				glob: params.glob_pattern,
				pattern: ".",
				mode: "files",
				signal,
			});
			const rels = files.map(f => displayPath(relative(target, resolve(ctx.cwd, f.path))));
			if (rels.length === 0) {
				return { content: [{ type: "text", text: `Result of search in '${target}': 0 files found` }] };
			}
			const offset = params.offset !== undefined && params.offset > 0 ? params.offset : 0;
			const head = `Result of search in '${target}' (total ${rels.length} ${rels.length === 1 ? "file" : "files"}):`;
			const parts = [head];
			let used = head.length + 1;
			let next = offset;
			for (; next < rels.length; next++) {
				const line = `- ${rels[next]}`;
				if (parts.length > 1 && used + line.length + 1 > RESULT_MAX_CHARS - FOOTER_RESERVE) break;
				used += line.length + 1;
				parts.push(line);
			}
			if (next < rels.length) {
				parts.push(`... ${rels.length - next} more files. Use offset=${next} to continue.`);
			}
			return { content: [{ type: "text", text: parts.join("\n") }] };
		},
	});

	pi.registerTool({
		name: "read",
		label: "read",
		...sharedRender("read"),
		loadMode: "essential",
		readsSkillUris: true,
		description:
			"Read a file or directory. Parameters: path (required; a path ending in :N reads from line N); offset (1-based start line; negative reads the last lines); limit (number of lines). " +
			"A local text file returns raw lines with every 10th line numbered; a partial read is bracketed by '... K lines not shown ...' lines, " +
			"and a long file ends with an offset to continue from. Output holds up to 100,000 characters. An empty file returns 'File is empty.'. " +
			"A line longer than the output budget is returned in fragments ending with " +
			"'[Use path=<file>:<line>:chars:<start>+<count> to continue]' (pass that string as path). A local directory returns a recursive tree; folders past the budget are listed with their file counts and a read hint. " +
			"omp selectors (:raw, :50-80, :50+30, :50-), URLs such as skill://, artifact://, local://, images, PDF, archives and databases use the native reader.",
		parameters: z.object({
			path: z.string(),
			offset: z.number().optional(),
			limit: z.number().optional(),
		}),
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const native = (path: string) => ctx.invokeTool!({ path }, { signal, onUpdate });
			const pathArg = normalizeInputPath(params.path);
			const shaped = (r: ReadResult) => ({
				content: [{ type: "text" as const, text: r.text }],
				details: r.details,
				...(r.error ? { isError: true } : {}),
			});

			if (pathArg.includes("://") && !urlHasSelector(pathArg)) {
				const agent = pathArg.match(/^agent:\/\/([\w-]+)$/);
				const agentFile = agent ? agentOutputPath(ctx.sessionManager, agent[1]!) : undefined;
				if (agentFile !== undefined && isRegularFile(agentFile)) {
					const raw = readFileSync(agentFile, "utf8");
					return shaped(
						readTextBody(agentOutputText(raw), Buffer.byteLength(raw, "utf8"), pathArg, textSel(params.offset, params.limit)),
					);
				}
				if (readExtensionSkip(pathArg)) return native(pathArg);
				if (params.offset !== undefined && params.offset < 0) return native(`${pathArg}:${params.offset}`);
				return pageNative(pathArg, params.offset, params.limit, native);
			}
			const frag = pathArg.match(/^([\s\S]+?):(\d+):chars:(\d+)\+(\d+)/);
			if (frag) {
				const fragAbs = resolve(ctx.cwd, frag[1]!);
				if (!isRegularFile(fragAbs)) {
					return pathExists(fragAbs)
						? errorResult(`Error: ${fragAbs} is a directory or not a regular file. A :<line>:chars:<start>+<count> fragment reads a line of a file; pass a file path, or no fragment to list a directory.`)
						: errorResult(missingPathText(fragAbs));
				}
				return shaped(
					readLocalText(fragAbs, frag[1]!, { line: Number(frag[2]), charStart: Number(frag[3]), charCount: Number(frag[4]) }),
				);
			}

			let file = pathArg;
			let start = params.offset;
			const lineSuffix = pathArg.match(/^([\s\S]+):(\d+)$/);
			if (lineSuffix && !pathExists(resolve(ctx.cwd, pathArg)) && isRegularFile(resolve(ctx.cwd, lineSuffix[1]!))) {
				file = lineSuffix[1]!;
				start = Number(lineSuffix[2]);
			}
			if (!isPlainLocalPath(file)) return native(file);
			const limit = params.limit;

			const abs = resolve(ctx.cwd, file);
			let st;
			try {
				st = statSync(abs);
			} catch {
				return errorResult(missingPathText(abs));
			}
			if (st.isDirectory()) {
				const entries = await directoryTreeEntries(abs, signal);
				return { content: [{ type: "text", text: treeText(abs, entries) }] };
			}
			if (!st.isFile() || isArchiveMemberPath(file) || readExtensionSkip(file) || hasNulInFirst8k(abs)) {
				if (!st.isFile() || (start === undefined && limit === undefined)) return native(file);
				if (start !== undefined && start < 0) return native(`${file}:${start}`);
				const from = start ?? 1;
				return native(limit === undefined ? `${file}:raw:${from}-` : `${file}:raw:${from}+${limit}`);
			}

			return shaped(readLocalText(abs, file, textSel(start, limit)));
		},
	});
}
