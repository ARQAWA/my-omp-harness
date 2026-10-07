import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { glob, grep } from "@oh-my-pi/pi-natives";
import { closeSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

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

const GLOB_CHAR_RE = /[*?[{]/;
const READ_DEFAULT_LIMIT = 3000;
const READ_BUDGET_BYTES = 90 * 1024;
const HOOK_TEXT_BUDGET = 100 * 1024;

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

function pathMatchesType(filePath: string, type: string): boolean {
	const exts = TYPE_EXTENSIONS[type];
	if (!exts) return false;
	const lower = filePath.toLowerCase();
	return exts.some(ext => lower.endsWith(ext));
}

function displayPath(matchPath: string): string {
	return matchPath.split(/[/\\]/).join("/");
}

function cwdRelativePath(cwd: string, absolutePath: string): string {
	const rel = relative(cwd, absolutePath);
	if (!rel || rel === "") return ".";
	return displayPath(rel);
}

function hookSignal(ctx: { signal?: AbortSignal; abortSignal?: AbortSignal }): AbortSignal | undefined {
	return ctx.signal ?? ctx.abortSignal;
}

function splitSearchPath(
	cwd: string,
	pathInput: string,
): { base: string; baseRel: string; glob?: string } | undefined {
	if (pathInput.includes(";")) return undefined;
	if (pathInput.includes("://")) return undefined;

	const resolved = resolve(cwd, pathInput === "" ? "." : pathInput);
	try {
		const st = statSync(resolved);
		if (st.isFile()) return undefined;
		if (st.isDirectory()) {
			return { base: resolved, baseRel: cwdRelativePath(cwd, resolved) };
		}
	} catch {
		if (!GLOB_CHAR_RE.test(pathInput)) return undefined;
	}

	const parts = pathInput.split("/").filter(p => p !== "" && p !== ".");
	let globStart = -1;
	for (let i = 0; i < parts.length; i++) {
		if (GLOB_CHAR_RE.test(parts[i]!)) {
			globStart = i;
			break;
		}
	}
	if (globStart === -1) return undefined;

	const baseParts = parts.slice(0, globStart);
	let globPart = parts.slice(globStart).join("/");
	if (globStart === 0) globPart = `**/${globPart}`;
	const base = baseParts.length === 0 ? resolve(cwd, ".") : resolve(cwd, baseParts.join("/"));
	return { base, baseRel: cwdRelativePath(cwd, base), glob: globPart };
}

function globSegmentDepth(glob: string): number {
	if (glob.includes("**")) return -1;
	if (glob === "") return 0;
	return glob.split("/").length - 1;
}

function pathDepthUnderBase(relativePath: string): number {
	if (!relativePath) return 0;
	return relativePath.split("/").length - 1;
}

function filterPathsByGlobDepth(paths: string[], base: string, globPart: string | undefined): string[] {
	const depth = globPart === undefined ? -1 : globSegmentDepth(globPart);
	if (depth < 0) return paths;
	return paths.filter(p => {
		const abs = resolve(base, p);
		const rel = displayPath(relative(base, abs));
		return pathDepthUnderBase(rel) === depth;
	});
}

function matchToCwdRel(cwd: string, base: string, matchPath: string): string {
	return displayPath(relative(cwd, resolve(base, matchPath)));
}

type HookFields = Record<string, unknown>;

function hookFields(value: unknown): HookFields {
	if (typeof value === "object" && value !== null) {
		return value as HookFields;
	}
	return {};
}

function inputString(input: HookFields, key: string): string | undefined {
	const v = input[key];
	return typeof v === "string" ? v : undefined;
}

function inputBoolean(input: HookFields, key: string): boolean | undefined {
	const v = input[key];
	return typeof v === "boolean" ? v : undefined;
}

function inputNumber(input: HookFields, key: string): number | undefined {
	const v = input[key];
	return typeof v === "number" ? v : undefined;
}

function detailTruthy(details: HookFields, key: string): boolean {
	return details[key] != null && details[key] !== false;
}

function detailsByteTruncated(details: HookFields): boolean {
	if (details.truncation != null) return true;
	if (!("meta" in details)) return false;
	const meta = details.meta;
	if (typeof meta !== "object" || meta === null || !("truncation" in meta)) return false;
	return meta.truncation != null;
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

function firstToolText(content: unknown): string {
	if (!Array.isArray(content) || content.length === 0) return "";
	const first = content[0];
	if (typeof first !== "object" || first === null) return "";
	if (!("type" in first) || first.type !== "text") return "";
	if (!("text" in first) || typeof first.text !== "string") return "";
	return first.text;
}

function nativePathToCwdRel(cwd: string, base: string, nativePath: string): string {
	return displayPath(relative(cwd, resolve(base, nativePath)));
}

function mapGlobPattern(globOpt?: string): string {
	if (!globOpt) return "**/*";
	if (!globOpt.includes("/")) return `**/${globOpt}`;
	return globOpt;
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

function shouldCompleteGrepResult(details: HookFields): boolean {
	if (detailTruthy(details, "fileLimitReached")) return true;
	return detailsByteTruncated(details);
}

function stripGrepPageNotices(text: string): string {
	const lines = text.split("\n");
	const out: string[] = [];
	for (const line of lines) {
		if (line.startsWith("Use skip=") || line.startsWith("Showing files")) continue;
		if (/^\[.*Use skip=.*\]$/.test(line)) continue;
		out.push(line);
	}
	return out.join("\n");
}

function trimIncompleteLastFile(text: string): string {
	const lines = text.split("\n");
	let lastHeading = -1;
	for (let i = 0; i < lines.length; i++) {
		if (/^#+\s+/.test(lines[i]!)) lastHeading = i;
	}
	if (lastHeading <= 0) return lastHeading === 0 ? "" : text;
	return lines.slice(0, lastHeading).join("\n");
}

function filesInGrepHeadingText(text: string): Set<string> {
	const set = new Set<string>();
	const stack: string[] = [];
	for (const line of text.split("\n")) {
		const m = line.match(/^(#+)\s+(.+)$/);
		if (!m) continue;
		const level = m[1]!.length;
		let name = m[2]!;
		const hash = name.indexOf("#");
		if (hash !== -1) name = name.slice(0, hash);
		const isDir = name.endsWith("/");
		if (isDir) name = name.slice(0, -1);
		stack.length = level - 1;
		stack[level - 1] = name;
		if (!isDir) set.add(displayPath(stack.join("/")));
	}
	return set;
}

function formatGrepFileBlock(filePath: string, matches: GrepMatch[]): string {
	const printed = new Set<number>();
	const entries: { lineNumber: number; line: string; isMatch: boolean }[] = [];
	for (const m of matches) {
		if (m.contextBefore) {
			for (const ctxLine of m.contextBefore) {
				if (!printed.has(ctxLine.lineNumber)) {
					printed.add(ctxLine.lineNumber);
					entries.push({ lineNumber: ctxLine.lineNumber, line: ctxLine.line, isMatch: false });
				}
			}
		}
		if (!printed.has(m.lineNumber)) {
			printed.add(m.lineNumber);
			entries.push({ lineNumber: m.lineNumber, line: m.line, isMatch: true });
		}
		if (m.contextAfter) {
			for (const ctxLine of m.contextAfter) {
				if (!printed.has(ctxLine.lineNumber)) {
					printed.add(ctxLine.lineNumber);
					entries.push({ lineNumber: ctxLine.lineNumber, line: ctxLine.line, isMatch: false });
				}
			}
		}
	}
	entries.sort((a, b) => a.lineNumber - b.lineNumber);
	const lines: string[] = ["", `# ${filePath}`];
	for (const e of entries) {
		const prefix = e.isMatch ? "*" : " ";
		lines.push(`${prefix}${e.lineNumber}:${e.line}`);
	}
	return lines.join("\n");
}

function textByteLength(text: string): number {
	return Buffer.byteLength(text, "utf8");
}

function longestPagePrefixInText(page: string[], textFileSet: Set<string>): number {
	let n = 0;
	for (const f of page) {
		if (!textFileSet.has(f)) break;
		n++;
	}
	return n;
}

type PathGroup = { kind: "dir" | "files"; name?: string; paths: string[] };

function buildPathGroups(sortedPaths: string[]): PathGroup[] {
	const groups: PathGroup[] = [];
	let i = 0;
	while (i < sortedPaths.length) {
		const p = sortedPaths[i]!;
		const slash = p.indexOf("/");
		if (slash === -1) {
			const files: string[] = [];
			while (i < sortedPaths.length && sortedPaths[i]!.indexOf("/") === -1) {
				files.push(sortedPaths[i]!);
				i++;
			}
			groups.push({ kind: "files", paths: files });
		} else {
			const d = p.slice(0, slash);
			const dirPaths: string[] = [];
			while (i < sortedPaths.length && sortedPaths[i]!.startsWith(`${d}/`)) {
				dirPaths.push(sortedPaths[i]!);
				i++;
			}
			groups.push({ kind: "dir", name: d, paths: dirPaths });
		}
	}
	return groups;
}

function joinBaseRel(baseRel: string, rel: string): string {
	if (baseRel === "." || baseRel === "") return rel;
	return `${baseRel}/${rel}`;
}

function globPatternLastSegment(P: string): string {
	const parts = P.split("/");
	return parts[parts.length - 1] ?? P;
}

function packGlobOutput(
	allPaths: string[],
	baseRel: string,
	P: string,
	budget: number,
): { text: string; shown: string[]; units: string[]; truncated: boolean } {
	const B = baseRel;
	const sorted = allPaths;

	function rel(p: string): string {
		if (B === "." || B === "") return p;
		const prefix = `${B}/`;
		return p.startsWith(prefix) ? p.slice(prefix.length) : p;
	}

	const relToFull = new Map<string, string>();
	for (const p of sorted) {
		relToFull.set(rel(p), p);
	}

	function fullFromRel(relPaths: string[]): string[] {
		return relPaths.map(r => relToFull.get(r)!);
	}

	const groups = buildPathGroups(sorted.map(rel));
	const shown: string[] = [];
	const units: string[] = [];
	const lines: string[] = [];
	let used = 0;

	function addPaths(paths: string[]): boolean {
		const block = paths.join("\n");
		const add = (lines.length ? 1 : 0) + textByteLength(block);
		if (used + add > budget) return false;
		if (lines.length) lines.push("");
		lines.push(...paths);
		used += add;
		shown.push(...paths);
		return true;
	}

	function forceAdd(paths: string[]): void {
		const block = paths.join("\n");
		const add = (lines.length ? 1 : 0) + textByteLength(block);
		if (lines.length) lines.push("");
		lines.push(...paths);
		used += add;
		shown.push(...paths);
	}

	if (!P.startsWith("**/")) {
		for (const group of groups) {
			forceAdd(fullFromRel(group.paths));
		}
		const truncated = shown.length < sorted.length;
		let text = lines.join("\n");
		if (truncated) {
			const footer = `More paths: ${sorted.length - shown.length} not shown. Continue with: ${units.map(u => `glob ${u}`).join(", ")}`;
			text = text ? `${text}\n${footer}` : footer;
		}
		return { text, shown, units, truncated };
	}

	const S = globPatternLastSegment(P);
	let somethingShown = false;

	for (const group of groups) {
		const full = fullFromRel(group.paths);
		if (addPaths(full)) {
			somethingShown = true;
			continue;
		}
		if (group.kind === "files") {
			forceAdd(full);
			somethingShown = true;
		} else if (group.kind === "dir" && group.name) {
			const d = group.name;
			if (!somethingShown) {
				const dPrefix = `${d}/`;
				const stripped = group.paths.map(r =>
					r.startsWith(dPrefix) ? r.slice(dPrefix.length) : r,
				);
				const inner = buildPathGroups(stripped);
				for (const sub of inner) {
					const subRel = sub.paths.map(p => `${d}/${p}`);
					if (addPaths(fullFromRel(subRel))) {
						somethingShown = true;
					} else if (sub.kind === "dir" && sub.name) {
						units.push(joinBaseRel(B, `${d}/${sub.name}/${P}`));
					} else {
						units.push(joinBaseRel(B, `${d}/${S}`));
					}
				}
			} else {
				units.push(joinBaseRel(B, `${d}/${P}`));
			}
		}
	}

	const truncated = units.length > 0 || shown.length < sorted.length;
	let text = lines.join("\n");
	if (truncated) {
		const footer = `More paths: ${sorted.length - shown.length} not shown. Continue with: ${units.map(u => `glob ${u}`).join(", ")}`;
		text = text ? `${text}\n${footer}` : footer;
	}
	return { text, shown, units, truncated };
}

function lineOutputBytes(line: string, lineNumber: number): number {
	return Buffer.byteLength(line.slice(0, 768), "utf8") + String(lineNumber).length + 2;
}

function parseReadPath(
	input: string,
): { file: string; raw: boolean; start: number; endInclusive: number; openEnded: boolean } | null {
	if (input.includes(",") || input.includes("://")) return null;
	if (/:conflicts|:img|:-\d+/.test(input)) return null;

	const raw = input.includes(":raw");
	let rest = input.replace(/:raw/g, "");

	const plus = rest.match(/^([\s\S]+):(\d+)\+(\d+)$/);
	if (plus) {
		const start = Number(plus[2]);
		const k = Number(plus[3]);
		return { file: plus[1]!, raw, start, endInclusive: start + k - 1, openEnded: false };
	}
	const range = rest.match(/^([\s\S]+):(\d+)-(\d+)$/);
	if (range) {
		return {
			file: range[1]!,
			raw,
			start: Number(range[2]),
			endInclusive: Number(range[3]),
			openEnded: false,
		};
	}
	const open = rest.match(/^([\s\S]+):(\d+)-$/);
	if (open) {
		const start = Number(open[2]);
		return { file: open[1]!, raw, start, endInclusive: start + READ_DEFAULT_LIMIT - 1, openEnded: true };
	}
	const line = rest.match(/^([\s\S]+):(\d+)$/);
	if (line) {
		const start = Number(line[2]);
		return { file: line[1]!, raw, start, endInclusive: start + READ_DEFAULT_LIMIT - 1, openEnded: true };
	}
	if (/^[\s\S]+:raw$/.test(input)) {
		return { file: input.replace(/:raw$/, ""), raw: true, start: 1, endInclusive: READ_DEFAULT_LIMIT, openEnded: false };
	}
	if (!/:\d/.test(rest)) {
		return { file: input.replace(/:raw$/, ""), raw, start: 1, endInclusive: READ_DEFAULT_LIMIT, openEnded: false };
	}
	return null;
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

function largestEndWithinBudget(lines: string[], startLine: number, endInclusive: number): number {
	let used = 0;
	let end = startLine - 1;
	for (let n = startLine; n <= endInclusive && n <= lines.length; n++) {
		const line = lines[n - 1] ?? "";
		const lineCost = lineOutputBytes(line, n);
		const withLine = used + lineCost;
		const contextReserve = 4 * lineCost;
		if (end >= startLine && withLine + contextReserve > READ_BUDGET_BYTES) break;
		used = withLine;
		end = n;
	}
	if (end < startLine && startLine <= lines.length) end = startLine;
	return end;
}

export default function rg(pi: ExtensionAPI) {
	pi.on("tool_result", async (event, ctx) => {
		try {
			if (event.toolName !== "grep" || event.isError) return;
			const details = hookFields(event.details);
			const input = hookFields(event.input);
			const skip = inputNumber(input, "skip") ?? 0;
			const continuationEmptyOmp =
				skip > 0 &&
				(details.fileCount === 0 ||
					details.fileCount === undefined ||
					details.files === undefined ||
					(Array.isArray(details.files) && details.files.length === 0));
			if (!shouldCompleteGrepResult(details) && !continuationEmptyOmp) return;

			const pattern = inputString(input, "pattern") ?? "";
			const pathInput = inputString(input, "path") ?? ".";
			const split = splitSearchPath(ctx.cwd, pathInput);
			if (!split) return;

			const ignoreCase = inputBoolean(input, "case") === false;
			const gitignore = inputBoolean(input, "gitignore") ?? true;
			const multiline = pattern.includes("\n") || pattern.includes("\\n");
			const signal = hookSignal(ctx);
			const nativeGlob = split.glob;

			const grepCommon = {
				pattern,
				path: split.base,
				glob: nativeGlob,
				ignoreCase,
				multiline,
				gitignore,
				hidden: true,
				timeoutMs: 30000,
				signal,
			};

			const countResult = await grep({ ...grepCommon, mode: "count" });
			const rawCountMatches = grepMatchesFrom(countResult);
			const countMatches = filterPathsByGlobDepth(
				rawCountMatches.map(m => m.path),
				split.base,
				nativeGlob,
			).map(path => rawCountMatches.find(m => m.path === path)!);

			const pagePaths = countMatches.map(m => matchToCwdRel(ctx.cwd, split.base, m.path));
			const page = pagePaths.slice(skip);
			if (continuationEmptyOmp && page.length === 0) return undefined;
			const pageSet = new Set(page);

			const countByPath = new Map<string, number>();
			for (const m of countMatches) {
				const rel = matchToCwdRel(ctx.cwd, split.base, m.path);
				countByPath.set(rel, m.matchCount ?? 0);
			}

			const fileMatches = page.map(path => ({ path, count: countByPath.get(path) ?? 0 }));
			const fileCount = page.length;
			const matchCount = fileMatches.reduce((s, f) => s + f.count, 0);

			const contentResult = await grep({
				...grepCommon,
				mode: "content",
				contextBefore: 1,
				contextAfter: 3,
				maxColumns: 512,
				maxCountPerFile: 20,
			});
			const contentByPath = new Map<string, GrepMatch[]>();
			const contentMatches = grepMatchesFrom(contentResult);
			const contentPaths = filterPathsByGlobDepth(
				contentMatches.map(m => m.path),
				split.base,
				nativeGlob,
			);
			const contentPathSet = new Set(contentPaths);
			for (const m of contentMatches) {
				if (!contentPathSet.has(m.path)) continue;
				const rel = matchToCwdRel(ctx.cwd, split.base, m.path);
				if (!contentByPath.has(rel)) contentByPath.set(rel, []);
				contentByPath.get(rel)!.push(m);
			}

			let text = continuationEmptyOmp ? "" : firstToolText(event.content);
			let headingFiles = new Set<string>();
			if (!continuationEmptyOmp) {
				text = stripGrepPageNotices(text);
				const byteTruncated = detailsByteTruncated(details);
				if (byteTruncated) text = trimIncompleteLastFile(text);
				headingFiles = filesInGrepHeadingText(text);
				if (![...headingFiles].every(f => pageSet.has(f))) {
					text = "";
					headingFiles = new Set();
				}
			}

			const textFiles = new Set(headingFiles);
			let stoppedAtBudget = false;

			for (const filePath of page) {
				if (textFiles.has(filePath)) continue;
				const block = formatGrepFileBlock(filePath, contentByPath.get(filePath) ?? []);
				const next = text ? `${text}${block}` : block.slice(1);
				if (textByteLength(next) > HOOK_TEXT_BUDGET) {
					stoppedAtBudget = true;
					break;
				}
				text = next;
				textFiles.add(filePath);
			}

			const prefixLen = longestPagePrefixInText(page, textFiles);
			if (stoppedAtBudget) {
				const footer = `More files: repeat the same call with skip=${skip + prefixLen}`;
				text = `${text}\n${footer}`;
			}

			const truncated =
				stoppedAtBudget || detailTruthy(details, "perFileLimitReached") || detailTruthy(details, "linesTruncated");

			return {
				content: [{ type: "text", text }],
				details: {
					...details,
					files: page,
					fileMatches,
					fileCount,
					matchCount,
					truncated,
					fileLimitReached: false,
				},
			};
		} catch {
			return undefined;
		}
	});

	pi.on("tool_result", async (event, ctx) => {
		try {
			if (event.toolName !== "glob" || event.isError) return;
			const details = hookFields(event.details);
			const input = hookFields(event.input);
			const limit = inputNumber(input, "limit");
			if (detailTruthy(details, "resultLimitReached")) {
				if (limit !== undefined && limit < 200) return;
			} else if (!detailTruthy(details, "truncated")) {
				return;
			}

			const pathInput = inputString(input, "path") ?? ".";
			const split = splitSearchPath(ctx.cwd, pathInput);
			if (!split) return;

			const P = split.glob ?? inputString(input, "pattern") ?? "**/*";
			const patternStr = inputString(input, "pattern") ?? "";
			const mentionNm = pathInput.includes("node_modules") || patternStr.includes("node_modules");
			const signal = hookSignal(ctx);

			const nativeResult = await glob({
				pattern: P,
				path: split.base,
				hidden: inputBoolean(input, "hidden") ?? true,
				gitignore: inputBoolean(input, "gitignore") ?? true,
				recursive: false,
				signal,
			});

			let paths = globNativePaths(nativeResult)
				.map(p => nativePathToCwdRel(ctx.cwd, split.base, p))
				.filter(p => !p.split("/").includes(".git"))
				.filter(p => mentionNm || !p.split("/").includes("node_modules"))
				.filter(p => {
					try {
						return statSync(resolve(ctx.cwd, p)).isFile();
					} catch {
						return false;
					}
				})
				.sort((a, b) => a.localeCompare(b));

			const packed = packGlobOutput(paths, split.baseRel, P, HOOK_TEXT_BUDGET);

			return {
				content: [{ type: "text", text: packed.text }],
				details: {
					...details,
					files: packed.shown,
					fileCount: packed.shown.length,
					truncated: packed.truncated,
					resultLimitReached: false,
				},
			};
		} catch {
			return undefined;
		}
	});

	pi.on("tool_call", async (event, ctx) => {
		try {
			if (event.toolName !== "read") return;
			const readInput = hookFields(event.input);
			const pathArg = inputString(readInput, "path");
			if (pathArg === undefined) return;

			const parsed = parseReadPath(pathArg);
			if (!parsed) return;

			const filePath = resolve(ctx.cwd, parsed.file);
			if (isArchiveMemberPath(parsed.file)) return;

			let st;
			try {
				st = statSync(filePath);
			} catch {
				return;
			}
			if (!st.isFile()) return;
			if (readExtensionSkip(parsed.file)) return;
			if (hasNulInFirst8k(filePath)) return;

			const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
			const lastLine =
				lines.length === 0 ? 0 : lines[lines.length - 1] === "" ? lines.length - 1 : lines.length;

			if (parsed.openEnded) {
				if (parsed.start > lastLine) return;
				const budgetEnd = largestEndWithinBudget(lines, parsed.start, lastLine);
				const end = Math.min(budgetEnd, lastLine);
				const count = end - parsed.start + 1;
				const rewritten = parsed.raw
					? `${parsed.file}:raw:${parsed.start}+${count}`
					: `${parsed.file}:${parsed.start}+${count}`;
				return { input: { ...readInput, path: rewritten } };
			}

			const end = largestEndWithinBudget(lines, parsed.start, parsed.endInclusive);
			if (end >= parsed.endInclusive || end >= lines.length) return;

			const count = end - parsed.start + 1;
			const rewritten = parsed.raw
				? `${parsed.file}:raw:${parsed.start}+${count}`
				: `${parsed.file}:${parsed.start}+${count}`;
			return { input: { ...readInput, path: rewritten } };
		} catch {
			return undefined;
		}
	});

	const z = pi.zod;
	const outputMode = z.enum(["content", "files_with_matches", "count", "files"]);

	pi.registerTool({
		name: "rg",
		label: "rg",
		loadMode: "essential",
		description:
			"Ripgrep-style search over file contents using the native engine with no per-call file cap. " +
			"Parameters: pattern (regex; not needed for files mode); path (file or directory, default working directory); glob (file glob filter); " +
			"type (js, ts, py, rust, go, java, c, cpp, md, json, yaml, toml, sh); output_mode (content | files_with_matches | count | files, default content); " +
			"-A, -B, -C (context lines; -C sets both when -A/-B omitted); -i (case insensitive); head_limit; offset; multiline. " +
			"files: every non-ignored file with its line count and size; pattern not needed; the map of a codebase. " +
			"For mapping a codebase, files mode or files_with_matches with one alternation of many terms is the fast path. " +
			"Content results are grouped by file, capped by head_limit and paged with offset. Respects .gitignore.",
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
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			if (params.type !== undefined && !(params.type in TYPE_EXTENSIONS)) {
				return { content: [{ type: "text", text: `Unknown type: ${params.type}` }] };
			}

			const globParam = params.glob === "" ? undefined : params.glob;
			const pathParam = params.path === "" ? undefined : params.path;
			const searchPath = resolve(ctx.cwd, pathParam ?? ".");
			const isFile = (() => {
				try {
					return statSync(searchPath).isFile();
				} catch {
					return false;
				}
			})();
			const prefix = relative(ctx.cwd, searchPath);
			function shown(p: string): string {
				return displayPath(isFile ? prefix : prefix ? join(prefix, p) : p);
			}
			const outputModeVal = params.output_mode ?? "content";
			const offset = params.offset ?? 0;
			const headLimitOrDefault = (limit: number | undefined, defaultLimit: number) =>
				limit !== undefined && Number.isFinite(limit) && limit > 0 ? limit : defaultLimit;

			if (outputModeVal === "files") {
				const headLimit = headLimitOrDefault(params.head_limit, 2000);
				try {
					const listResult = await glob({
						pattern: mapGlobPattern(globParam),
						path: searchPath,
						hidden: true,
						gitignore: true,
						recursive: false,
						signal,
					});
					let files = globNativePaths(listResult)
						.map(p => nativePathToCwdRel(ctx.cwd, searchPath, p))
						.filter(p => !p.split("/").includes(".git"))
						.filter(p => {
							try {
								return statSync(resolve(ctx.cwd, p)).isFile();
							} catch {
								return false;
							}
						});
					if (params.type !== undefined) {
						files = files.filter(p => pathMatchesType(p, params.type!));
					}
					files.sort((a, b) => a.localeCompare(b));

					const countResult = await grep({
						pattern: "^",
						path: searchPath,
						glob: globParam,
						hidden: true,
						gitignore: true,
						mode: "count",
						signal,
						timeoutMs: 30000,
					});
					const lineCounts = new Map<string, number>();
					for (const m of grepMatchesFrom(countResult)) {
						const rel = matchToCwdRel(ctx.cwd, searchPath, m.path);
						lineCounts.set(rel, m.matchCount ?? 0);
					}

					const slice = files.slice(offset, offset + headLimit);
					const truncated = offset + slice.length < files.length;
					const lines = slice.map(f => {
						const linesN = lineCounts.get(f) ?? 0;
						const sizeKb = (statSync(resolve(ctx.cwd, f)).size / 1024).toFixed(1);
						return `${displayPath(f)}:${linesN}:${sizeKb}KB`;
					});
					if (truncated) lines.push(`More results: use offset=${offset + slice.length}`);
					if (lines.length === 0) {
						return { content: [{ type: "text", text: "No matches" }] };
					}
					return { content: [{ type: "text", text: lines.join("\n") }] };
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					return { content: [{ type: "text", text: message }] };
				}
			}

			if (params.pattern === undefined || params.pattern === "") {
				return { content: [{ type: "text", text: "pattern is required" }] };
			}

			let contextBefore = params["-B"];
			let contextAfter = params["-A"];
			if (params["-C"] !== undefined) {
				if (contextBefore === undefined) contextBefore = params["-C"];
				if (contextAfter === undefined) contextAfter = params["-C"];
			}

			const mode =
				outputModeVal === "files_with_matches"
					? "filesWithMatches"
					: outputModeVal === "count"
						? "count"
						: "content";

			const defaultHead = outputModeVal === "content" ? 300 : 1000;
			const headLimit = headLimitOrDefault(params.head_limit, defaultHead);

			let result: {
				matches: GrepMatch[];
				totalMatches: number;
				filesWithMatches: number;
				filesSearched: number;
				limitReached?: boolean;
				skippedOversized?: boolean;
			};

			try {
				result = await grep({
					pattern: params.pattern,
					path: searchPath,
					glob: globParam,
					ignoreCase: params["-i"],
					multiline: params.multiline,
					hidden: true,
					gitignore: true,
					...(outputModeVal === "content" ? { contextBefore, contextAfter } : {}),
					maxColumns: 300,
					mode,
					maxCount: 100000,
					signal,
					timeoutMs: 30000,
				});
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				if (message.startsWith("regex parse error") || message.startsWith("regex error")) {
					return { content: [{ type: "text", text: `Invalid regex: ${message}` }] };
				}
				throw err;
			}

			let matches = result.matches;
			if (params.type !== undefined) {
				matches = matches.filter(m => pathMatchesType(m.path, params.type!));
			}

			if (matches.length === 0) {
				return { content: [{ type: "text", text: "No matches" }] };
			}

			let truncated = false;
			let shownCount = 0;

			if (outputModeVal === "content") {
				const matchingLines = matches.filter(m => m.lineNumber > 0);
				const slice = matchingLines.slice(offset, offset + headLimit);
				truncated = offset + slice.length < matchingLines.length;
				shownCount = slice.length;

				const fileOrder: string[] = [];
				const seenFiles = new Set<string>();
				for (const m of slice) {
					if (!seenFiles.has(m.path)) {
						seenFiles.add(m.path);
						fileOrder.push(m.path);
					}
				}

				const lines: string[] = [];
				for (const filePath of fileOrder) {
					lines.push(shown(filePath));
					const fileMatches = slice.filter(m => m.path === filePath);
					const printed = new Set<number>();
					const entries: { lineNumber: number; line: string; isMatch: boolean }[] = [];

					for (const m of fileMatches) {
						if (m.contextBefore) {
							for (const ctxLine of m.contextBefore) {
								if (!printed.has(ctxLine.lineNumber)) {
									printed.add(ctxLine.lineNumber);
									entries.push({ lineNumber: ctxLine.lineNumber, line: ctxLine.line, isMatch: false });
								}
							}
						}
						if (!printed.has(m.lineNumber)) {
							printed.add(m.lineNumber);
							entries.push({ lineNumber: m.lineNumber, line: m.line, isMatch: true });
						}
						if (m.contextAfter) {
							for (const ctxLine of m.contextAfter) {
								if (!printed.has(ctxLine.lineNumber)) {
									printed.add(ctxLine.lineNumber);
									entries.push({ lineNumber: ctxLine.lineNumber, line: ctxLine.line, isMatch: false });
								}
							}
						}
					}

					entries.sort((a, b) => a.lineNumber - b.lineNumber);
					for (const e of entries) {
						const sep = e.isMatch ? ":" : "-";
						lines.push(`${e.lineNumber}${sep}${e.line}`);
					}
					lines.push("");
				}

				if (truncated) {
					lines.push(`More results: use offset=${offset + shownCount}`);
				}
				const text = lines.join("\n").replace(/\n$/, "");
				return { content: [{ type: "text", text: text === "" ? "No matches" : text }] };
			}

			if (outputModeVal === "files_with_matches") {
				const files: string[] = [];
				const seen = new Set<string>();
				for (const m of matches) {
					if (!seen.has(m.path)) {
						seen.add(m.path);
						files.push(m.path);
					}
				}
				const slice = files.slice(offset, offset + headLimit);
				truncated = offset + slice.length < files.length;
				shownCount = slice.length;
				const lines = slice.map(f => shown(f));
				if (truncated) lines.push(`More results: use offset=${offset + shownCount}`);
				const text = lines.join("\n");
				return { content: [{ type: "text", text: text === "" ? "No matches" : text }] };
			}

			const files: { path: string; count: number }[] = [];
			const seen = new Set<string>();
			for (const m of matches) {
				if (!seen.has(m.path)) {
					seen.add(m.path);
					files.push({ path: m.path, count: m.matchCount ?? 0 });
				}
			}
			const slice = files.slice(offset, offset + headLimit);
			truncated = offset + slice.length < files.length;
			shownCount = slice.length;
			const lines = slice.map(f => `${shown(f.path)}:${f.count}`);
			if (truncated) lines.push(`More results: use offset=${offset + shownCount}`);
			const text = lines.join("\n");
			return { content: [{ type: "text", text: text === "" ? "No matches" : text }] };
		},
	});
}
