import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { lookup } from "@oh-my-pi/pi-coding-agent/config/registry";
import { glob, grep } from "@oh-my-pi/pi-natives";
import type { Component } from "@oh-my-pi/pi-tui";
import { type ToolRenderer, toolRenderers } from "@oh-my-pi/pi-tui/tools";
import { closeSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";

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
};

const TYPE_KEYS = Object.keys(TYPE_EXTENSIONS) as [string, ...string[]];

const READ_RESERVE = 300;
const READ_BUDGET_BYTES = 90 * 1024;
const READ_MAX_CHARS = 100000;
const OUTPUT_CAP = 2000;
const MAX_COLUMNS = 1000;
const GLOB_BUDGET_CHARS = 5000;
const TREE_BUDGET_CHARS = 2500;
const LONG_LINE_MARKER = " [... omitted end of long line]";

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

type SearchEntry = { lineNumber: number; line: string; isMatch: boolean };
type SearchFile = { path: string; count: number; entries: SearchEntry[] };
type SearchMode = "content" | "filesWithMatches" | "count" | "files";

function pathMatchesType(filePath: string, type: string): boolean {
	const exts = TYPE_EXTENSIONS[type];
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

type HookFields = Record<string, unknown>;

function hookFields(value: unknown): HookFields {
	if (typeof value === "object" && value !== null) {
		return value as HookFields;
	}
	return {};
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

function cutLongLine(line: string): string {
	return line.length > MAX_COLUMNS ? `${line.slice(0, MAX_COLUMNS)}${LONG_LINE_MARKER}` : line;
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
		const matchLines = new Set(slot.matches.map(m => m.lineNumber));
		const added = new Set<number>();
		const entries: SearchEntry[] = [];
		for (const m of slot.matches) {
			if (!added.has(m.lineNumber)) {
				added.add(m.lineNumber);
				entries.push({ lineNumber: m.lineNumber, line: m.line, isMatch: true });
			}
			for (const c of [...(m.contextBefore ?? []), ...(m.contextAfter ?? [])]) {
				if (matchLines.has(c.lineNumber) || added.has(c.lineNumber)) continue;
				added.add(c.lineNumber);
				entries.push({ lineNumber: c.lineNumber, line: c.line, isMatch: false });
			}
		}
		entries.sort((a, b) => a.lineNumber - b.lineNumber);
		return { path: f.rel, count: slot.count, entries };
	});
}

function contentLines(files: SearchFile[]): string[] {
	const lines: string[] = [];
	files.forEach((f, i) => {
		if (i > 0) lines.push("");
		lines.push(f.path);
		for (const e of f.entries) {
			lines.push(`  ${e.lineNumber}${e.isMatch ? ":" : "-"}${cutLongLine(e.line)}`);
		}
	});
	return lines;
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
	return (
		text.length <= READ_MAX_CHARS - READ_RESERVE &&
		Buffer.byteLength(text, "utf8") <= READ_BUDGET_BYTES - READ_RESERVE
	);
}

function readDetails(text: string, total: number, fileSize: number, outputLines: number, truncated: boolean) {
	return {
		truncation: {
			truncated,
			truncatedBy: truncated ? "bytes" : null,
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
	if (line < 1 || line > total) return { text: "Error: line out of range", details: {}, error: true };
	const s = lines[line - 1]!;
	if (charStart >= s.length && s.length > 0) return { text: "Error: char offset out of range", details: {}, error: true };
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
	const lines = splitFileLines(readFileSync(abs, "utf8"));
	const total = lines.length;
	const fileSize = statSync(abs).size;
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
	let bytes = 0;
	for (let n = start; n <= end; n++) {
		const body = lines[n - 1]!;
		const text = total >= 10 && n % 10 === 0 ? `${String(n).padStart(6)}|${body}` : body;
		const sep = shown.length > 0 ? 1 : 0;
		if (
			chars + sep + text.length > READ_MAX_CHARS - READ_RESERVE ||
			bytes + sep + Buffer.byteLength(text, "utf8") > READ_BUDGET_BYTES - READ_RESERVE
		)
			break;
		chars += sep + text.length;
		bytes += sep + Buffer.byteLength(text, "utf8");
		shown.push(text);
	}
	if (shown.length === 0 && start <= end) return readFragment(lines, fileSize, pathLabel, start, 0, Number.MAX_SAFE_INTEGER);

	const fit = start - 1 + shown.length;
	const out: string[] = [];
	if (start > 1) out.push(`... ${start - 1} lines not shown ...`);
	out.push(...shown);
	if (fit < end) {
		out.push(`... ${total - fit} lines not shown ...`, `[Use offset=${fit + 1} to continue]`);
	} else if (end < total) {
		out.push(`... ${total - end} lines not shown ...`);
	}
	const text = out.join("\n");
	return { text, details: readDetails(text, total, fileSize, shown.length, fit < end) };
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

type TreeEntry = { depth: number; name: string; dir: boolean; unexpanded?: string };

function walkTree(node: TreeNode, depth: number, budget: { left: number }, out: TreeEntry[]): void {
	const names: { name: string; dir: boolean }[] = [
		...[...node.dirs.keys()].map(name => ({ name, dir: true })),
		...node.files.map(name => ({ name, dir: false })),
	].sort((a, b) => a.name.localeCompare(b.name));
	for (const item of names) {
		if (!item.dir) {
			if (budget.left <= 0) continue;
			budget.left -= item.name.length;
			out.push({ depth, name: item.name, dir: false });
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
				unexpanded: `[${treeFileCount(child)} files: ${byCount.join(", ")}]`,
			});
			continue;
		}
		budget.left -= item.name.length;
		out.push({ depth, name: item.name, dir: true });
		walkTree(child, depth + 1, budget, out);
	}
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
	walkTree(buildTree(files), 0, { left: TREE_BUDGET_CHARS - dir.length }, out);
	return out;
}

function treeText(dir: string, entries: TreeEntry[]): string {
	const lines = [`${dir}/`];
	for (const e of entries) {
		const indent = "  ".repeat(e.depth + 1);
		if (e.unexpanded) lines.push(`${indent}${e.name}/ ${e.unexpanded}`);
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

/** The tool draws through omp's renderer for its name, so display extensions that patch that renderer apply to it. */
function sharedRender(name: string) {
	const host = toolRenderers[name]!;
	return {
		renderCall: (...args: Parameters<ToolRenderer["renderCall"]>) => host.renderCall(...args) as Component,
		renderResult: (...args: Parameters<ToolRenderer["renderResult"]>) => host.renderResult(...args) as Component,
	};
}

export default function rg(pi: ExtensionAPI) {
	pi.on("session_start", async _event => {
		try {
			lookup("edit.mode")?.override(pi.pi.settings, "replace");
			lookup("edit.modelVariants")?.override(pi.pi.settings, { gpt: "apply_patch" });
		} catch {}
	});

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
			"Ripgrep search over file contents. Parameters: pattern (regex); path (file or directory, default working directory); glob (file glob filter; without '/' it matches the base name at any depth; a leading ! excludes the matching files); " +
			"type (js, ts, py, rust, go, java, c, cpp, md, json, yaml, toml, sh); output_mode (content | files_with_matches | count, default content); " +
			"-A, -B, -C (context lines; -C applies only when -A/-B are absent); -i (case insensitive; search is case-sensitive by default); head_limit and offset (over output lines); multiline. " +
			"Hidden files are searched and .gitignore is respected. Files are ordered newest-modified first and output is capped at 2,000 lines or files; " +
			"a cut result ends with a [Showing paginated results, limit=N, offset=M] line. " +
			"A path with a URL scheme, such as history://, artifact:// or local://, goes to omp's native search, which uses only pattern, path and -i.",
		parameters: z.object({
			pattern: z.string().optional(),
			path: z.string().optional(),
			glob: z.string().optional(),
			type: z.enum(TYPE_KEYS).optional(),
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
			if (params.type !== undefined && !(params.type in TYPE_EXTENSIONS)) {
				return { content: [{ type: "text", text: `Unknown type: ${params.type}` }] };
			}
			if (params.pattern === undefined || params.pattern === "") {
				return { content: [{ type: "text", text: "pattern is required" }] };
			}
			if (params.path?.includes("://")) {
				return ctx.invokeTool!(
					{ pattern: params.pattern, path: params.path, ...(params["-i"] ? { case: false } : {}) },
					{ signal, onUpdate },
				);
			}

			const pathParam = params.path === "" ? undefined : params.path;
			const searchPath = resolve(ctx.cwd, pathParam ?? ".");
			let isFile = false;
			try {
				isFile = statSync(searchPath).isFile();
			} catch {
				return { content: [{ type: "text", text: `Error: Path does not exist: ${searchPath}` }] };
			}
			const base = isFile ? resolve(searchPath, "..") : searchPath;
			const fileGlob = isFile ? searchPath.slice(base.length + 1) : params.glob === "" ? undefined : params.glob;
			const excludeGlob = fileGlob?.startsWith("!") ? fileGlob.slice(1) : undefined;

			let before = params["-B"];
			let after = params["-A"];
			if (before === undefined && after === undefined && params["-C"] !== undefined) {
				before = params["-C"];
				after = params["-C"];
			}

			const modeVal = params.output_mode ?? "content";
			const mode: SearchMode = modeVal === "files_with_matches" ? "filesWithMatches" : modeVal;
			const offset = params.offset !== undefined && params.offset > 0 ? params.offset : 0;
			const headLimit =
				params.head_limit !== undefined && Number.isFinite(params.head_limit) && params.head_limit > 0
					? params.head_limit
					: undefined;

			let files: SearchFile[];
			try {
				files = await runSearch({
					cwd: ctx.cwd,
					base,
					glob: excludeGlob === undefined ? fileGlob : undefined,
					exclude: excludeGlob,
					pattern: params.pattern,
					mode,
					ignoreCase: params["-i"],
					before,
					after,
					multiline: params.multiline,
					type: params.type,
					signal,
				});
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				if (message.startsWith("regex parse error") || message.startsWith("regex error")) {
					return { content: [{ type: "text", text: `Invalid regex: ${message}` }] };
				}
				throw err;
			}

			let body: string[];
			let total: number;
			if (modeVal === "content") {
				body = contentLines(files);
				total = body.length;
			} else if (modeVal === "files_with_matches") {
				body = files.map(f => `./${f.path}`);
				total = body.length;
			} else {
				body = files.map(f => `./${f.path}:${f.count}`);
				total = body.length;
			}

			const limit = headLimit ?? OUTPUT_CAP;
			const effective = Math.min(limit, OUTPUT_CAP);
			const slice = body.slice(offset, offset + effective);
			const cut = offset + slice.length < total;
			if (slice.length === 0) {
				return {
					content: [
						{
							type: "text",
							text: `<workspace_result workspace_path="${ctx.cwd}">\nNo matches found\n</workspace_result>`,
						},
					],
				};
			}
			if (cut) slice.push(`[Showing paginated results, limit=${effective}, offset=${offset}]`);
			return {
				content: [
					{
						type: "text",
						text: `<workspace_result workspace_path="${ctx.cwd}">\n${slice.join("\n")}\n</workspace_result>`,
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
			"Find files by glob pattern, recursively. Parameters: glob_pattern (required; a pattern without a leading **/ matches at any depth; braces work); target_directory (default working directory). " +
			"Hidden files are included, .gitignore is respected, empty files are absent, and files are listed newest-modified first. " +
			"A long list is cut with a '... K more files ...' line; use a more specific pattern.",
		parameters: z.object({
			glob_pattern: z.string(),
			target_directory: z.string().optional(),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const target = resolve(ctx.cwd, params.target_directory ?? ".");
			if (!isDirectory(target)) {
				return { content: [{ type: "text", text: `Error: Path does not exist: ${target}` }] };
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
			const lines: string[] = [];
			let used = 0;
			for (const rel of rels) {
				const line = `- ${rel}`;
				if (used + line.length + 1 > GLOB_BUDGET_CHARS && lines.length > 0) break;
				used += line.length + 1;
				lines.push(line);
			}
			const head = `Result of search in '${target}' (total ${rels.length} ${rels.length === 1 ? "file" : "files"}):`;
			const parts = [head, ...lines];
			if (lines.length < rels.length) {
				parts.push(`... ${rels.length - lines.length} more files ... (Do a more specific search if needed)`);
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
			"Read a file or directory. Parameters: path (required); offset (1-based start line; negative reads the last lines); limit (number of lines). " +
			"A local text file returns raw lines with every 10th line numbered; a partial read is bracketed by '... K lines not shown ...' lines, " +
			"and a long file ends with an offset to continue from. A line longer than the output budget is returned in fragments ending with " +
			"'[Use path=<file>:<line>:chars:<start>+<count> to continue]' (pass that string as path). A local directory returns a recursive tree. " +
			"omp selectors (:raw, :50-80, :50+30, :50-), URLs such as skill://, artifact://, local://, images, PDF, archives and databases use the native reader.",
		parameters: z.object({
			path: z.string(),
			offset: z.number().optional(),
			limit: z.number().optional(),
		}),
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const native = (path: string) => ctx.invokeTool!({ path }, { signal, onUpdate });
			const pathArg = params.path;
			const notFound = { content: [{ type: "text" as const, text: "Error: File not found" }], isError: true };
			const shaped = (r: ReadResult) => ({
				content: [{ type: "text" as const, text: r.text }],
				details: r.details,
				...(r.error ? { isError: true } : {}),
			});

			const frag = pathArg.match(/^([\s\S]+?):(\d+):chars:(\d+)\+(\d+)/);
			if (frag) {
				const fragAbs = resolve(ctx.cwd, frag[1]!);
				if (!statSync(fragAbs, { throwIfNoEntry: false })?.isFile()) return notFound;
				return shaped(
					readLocalText(fragAbs, frag[1]!, { line: Number(frag[2]), charStart: Number(frag[3]), charCount: Number(frag[4]) }),
				);
			}

			if (!isPlainLocalPath(pathArg)) return native(pathArg);
			const file = pathArg;
			const start = params.offset;
			const limit = params.limit;

			const abs = resolve(ctx.cwd, file);
			let st;
			try {
				st = statSync(abs);
			} catch {
				return notFound;
			}
			if (st.isDirectory()) {
				const entries = await directoryTreeEntries(abs, signal);
				return { content: [{ type: "text", text: treeText(abs, entries) }] };
			}
			if (!st.isFile() || isArchiveMemberPath(file) || readExtensionSkip(file) || hasNulInFirst8k(abs)) {
				const { offset, limit: nativeLimit } = params;
				if (!st.isFile() || (offset === undefined && nativeLimit === undefined)) return native(pathArg);
				if (offset !== undefined && offset < 0) return native(`${pathArg}:${offset}`);
				const from = offset ?? 1;
				return native(
					nativeLimit === undefined ? `${pathArg}:raw:${from}-` : `${pathArg}:raw:${from}+${nativeLimit}`,
				);
			}

			const lim = limit !== undefined && limit > 0 ? limit : undefined;
			const off = start === 0 ? undefined : start;
			const sel: ReadSel =
				off !== undefined && off < 0 ? { start: 1, limit: lim, offsetNeg: -off } : { start: off ?? 1, limit: lim };
			return shaped(readLocalText(abs, file, sel));
		},
	});
}
