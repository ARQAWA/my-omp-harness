// Result text of grep and glob: formatters, pagination, the result cache and the glob listing.
import { basename, isAbsolute, relative, resolve } from "node:path";

// 50 KB in characters, Pi's output size, with no line cap (see DECISIONS.md).
export const GREP_CHAR_BUDGET = 51_200;
export const GLOB_CHAR_BUDGET = 51_200;

export type OutputMode = "content" | "files_with_matches" | "count";

export interface ContentMatch {
	lineNumber: number;
	content: string;
	isContextLine: boolean;
}

export interface FileMatch {
	file: string;
	matches: ContentMatch[];
}

export interface PageInfo {
	headLimitApplied?: number;
	offsetApplied?: number;
}

export interface ContentValue extends PageInfo {
	matches: FileMatch[];
	totalLines: number;
	totalMatchedLines: number;
	clientTruncated: boolean;
	ripgrepTruncated: boolean;
}

export interface FilesValue extends PageInfo {
	files: string[];
	totalFiles: number;
	clientTruncated: boolean;
	ripgrepTruncated: boolean;
}

export interface CountValue extends PageInfo {
	counts: { file: string; count: number }[];
	totalFiles: number;
	totalMatches: number;
	clientTruncated: boolean;
	ripgrepTruncated: boolean;
}

export type SearchUnion =
	| { mode: "content"; value: ContentValue }
	| { mode: "files_with_matches"; value: FilesValue }
	| { mode: "count"; value: CountValue };

export interface SearchSuccess {
	pattern: string;
	path: string | undefined;
	root: string;
	union: SearchUnion;
}

export interface ToolText {
	content: { type: "text"; text: string }[];
	details: undefined;
	isError?: true;
}

export function toolText(text: string, isError = false): ToolText {
	return isError ? { content: [{ type: "text", text }], details: undefined, isError: true } : { content: [{ type: "text", text }], details: undefined };
}

// The first and last halves of the limit, joined by a marker.
export function truncateOutput(output: string, maxLength: number): string {
	if (output.length <= maxLength) return output;
	const half = Math.floor(maxLength / 2);
	return `${output.substring(0, half)}\n\n... (output truncated) ...\n\n${output.substring(output.length - half)}`;
}

// Joins lines, trims, and keeps whole lines that fit the budget.
function truncateLines(lines: string[], charBudget: number): { content: string; truncated: boolean; keptLines: number } {
	const joined = lines.join("\n");
	const content = joined.trim();
	if (content.length <= charBudget) return { content, truncated: false, keptLines: lines.length };
	const cut = content.substring(0, charBudget);
	const lastNewline = cut.lastIndexOf("\n");
	if (lastNewline === -1) return { content: "... [First line would be too large to fit within character budget] ...", truncated: true, keptLines: 0 };
	const cutIndex = joined.length - joined.trimStart().length + lastNewline;
	return { content: cut.substring(0, lastNewline).trim(), truncated: true, keptLines: joined.slice(0, cutIndex).split("\n").length };
}

interface Footer {
	headLimitApplied?: number;
	offsetApplied?: number;
	charTruncated: boolean;
	clientTruncated: boolean;
	ripgrepTruncated: boolean;
	shown: number;
	returned: number;
	total: number;
	unit: string;
	singleWorkspace: boolean;
}

function buildFooter(footer: Footer): string {
	const offset = footer.offsetApplied ?? 0;
	const end = offset + footer.returned;
	const reachedEnd = footer.headLimitApplied === undefined || footer.returned < footer.headLimitApplied;
	const cutBeforeEnd = footer.ripgrepTruncated || (reachedEnd && (footer.clientTruncated || end < footer.total));
	const nextStep = describeNextStep(footer, { offset, end, reachedEnd, cutBeforeEnd });
	if (nextStep === undefined) return "";
	const lead = footer.charTruncated || cutBeforeEnd ? "Results truncated. " : "";
	const shown = footer.shown === 0 ? "none" : offset === 0 ? `${footer.shown}` : `${offset + 1}-${offset + footer.shown}`;
	const total = Math.max(footer.total, end);
	const isLowerBound = footer.ripgrepTruncated || (footer.clientTruncated && (!reachedEnd || footer.total <= end));
	const totalText = `${isLowerBound ? "at least " : ""}${total} ${footer.unit}${total === 1 ? "" : "s"}`;
	return `\n[${lead}Showing ${shown} of ${totalText}. ${nextStep}]`;
}

function describeNextStep(
	footer: Footer,
	position: { offset: number; end: number; reachedEnd: boolean; cutBeforeEnd: boolean },
): string | undefined {
	const fullPageMayHaveMore = !position.reachedEnd && (position.end < footer.total || footer.clientTruncated || footer.ripgrepTruncated);
	const canContinue = footer.shown > 0 && (footer.shown < footer.returned || fullPageMayHaveMore);
	if (!canContinue) {
		const hidesMatches = footer.charTruncated && footer.shown < footer.returned;
		return position.cutBeforeEnd || hidesMatches ? "Narrow the search to see the rest." : undefined;
	}
	if (!footer.singleWorkspace) return "Set path to one workspace to page through it, or narrow the search.";
	const nextOffset = position.offset + footer.shown;
	if (position.cutBeforeEnd && position.reachedEnd) {
		return `Use offset=${nextOffset} to see more of the first ${position.end}, or narrow the search to see the rest.`;
	}
	return `Use offset=${nextOffset} to see more, or narrow the search.`;
}

function formatContent(value: ContentValue, charBudget: number): string {
	const lines: string[] = [];
	const isMatchLine: boolean[] = [];
	const hasContext = value.matches.some((fm) => fm.matches.some((m) => m.isContextLine));
	for (const fm of value.matches) {
		lines.push(fm.file);
		isMatchLine.push(false);
		let previousLineNumber: number | undefined;
		for (const m of fm.matches) {
			if (hasContext && previousLineNumber !== undefined && m.lineNumber - previousLineNumber > 1) {
				lines.push("  --");
				isMatchLine.push(false);
			}
			previousLineNumber = m.lineNumber;
			lines.push(`  ${m.lineNumber}${m.isContextLine ? "-" : ":"}${m.content}`);
			isMatchLine.push(!m.isContextLine);
		}
		lines.push("");
		isMatchLine.push(false);
	}
	const { content, truncated, keptLines } = truncateLines(lines, charBudget);
	return content + buildFooter({
		headLimitApplied: value.headLimitApplied,
		offsetApplied: value.offsetApplied,
		charTruncated: truncated,
		clientTruncated: value.clientTruncated,
		ripgrepTruncated: value.ripgrepTruncated,
		shown: isMatchLine.slice(0, keptLines).filter(Boolean).length,
		returned: isMatchLine.filter(Boolean).length,
		total: value.totalMatchedLines,
		unit: "matching line",
		singleWorkspace: true,
	});
}

function formatFiles(value: FilesValue, charBudget: number): string {
	const { content, truncated, keptLines } = truncateLines(value.files, charBudget);
	return content + buildFooter({
		headLimitApplied: value.headLimitApplied,
		offsetApplied: value.offsetApplied,
		charTruncated: truncated,
		clientTruncated: value.clientTruncated,
		ripgrepTruncated: value.ripgrepTruncated,
		shown: keptLines,
		returned: value.files.length,
		total: value.totalFiles,
		unit: "file",
		singleWorkspace: true,
	});
}

function formatCount(value: CountValue, charBudget: number): string {
	const lines = value.counts.map((c) => `${c.file}:${c.count}`);
	const { content, truncated, keptLines } = truncateLines(lines, charBudget);
	return content + buildFooter({
		headLimitApplied: value.headLimitApplied,
		offsetApplied: value.offsetApplied,
		charTruncated: truncated,
		clientTruncated: value.clientTruncated,
		ripgrepTruncated: value.ripgrepTruncated,
		shown: keptLines,
		returned: lines.length,
		total: value.totalFiles,
		unit: "file",
		singleWorkspace: true,
	});
}

// Text for an empty page: the empty text on the first page, or a note about the offset past the end.
function describeEmptyPage(page: PageInfo & { clientTruncated: boolean; ripgrepTruncated: boolean }, total: number, emptyText: string): string {
	const offset = page.offsetApplied ?? 0;
	if (offset === 0 || total === 0) return emptyText;
	const moreExist = page.clientTruncated || page.ripgrepTruncated || offset < total;
	return moreExist ? `No more results at offset=${offset}. Narrow the search to see the rest.` : `No more results at offset=${offset}.`;
}

function formatBlock(union: SearchUnion, charBudget: number): string {
	switch (union.mode) {
		case "content":
			return union.value.matches.length === 0
				? describeEmptyPage(union.value, union.value.totalMatchedLines, "No matches found")
				: formatContent(union.value, charBudget);
		case "files_with_matches":
			return union.value.files.length === 0
				? describeEmptyPage(union.value, union.value.totalFiles, "No files with matches found")
				: formatFiles(union.value, charBudget);
		case "count":
			return union.value.counts.length === 0
				? describeEmptyPage(union.value, union.value.totalFiles, "No matches found")
				: formatCount(union.value, charBudget);
	}
}

// The model-facing text of a search: one workspace_result block, with the char budget applied when the block is too long.
export function formatSearchResult(success: SearchSuccess): string {
	const full = formatBlock(success.union, Number.MAX_SAFE_INTEGER);
	const budget = full.length > GREP_CHAR_BUDGET ? GREP_CHAR_BUDGET : full.length;
	const section = formatBlock(success.union, budget);
	return `<workspace_result workspace_path="${success.root}">\n${section}\n</workspace_result>\n`.trim();
}

// Model-facing text of a search error, cut to the budget.
export function formatSearchError(message: string): string {
	return `Error running tool: ${truncateOutput(message, GREP_CHAR_BUDGET)}`;
}

function paginateArray<T>(items: T[], offset: number, headLimit: number | undefined): { items: T[]; truncated: boolean } {
	const start = Math.min(offset, items.length);
	const end = headLimit !== undefined ? Math.min(start + headLimit, items.length) : items.length;
	return { items: items.slice(start, end), truncated: headLimit !== undefined && start + headLimit < items.length };
}

function paginateContent(value: ContentValue, offset: number, headLimit: number | undefined): ContentValue {
	const limit = headLimit ?? Number.POSITIVE_INFINITY;
	let skipped = 0;
	let collected = 0;
	let hasMoreMatches = false;
	const matches: FileMatch[] = [];
	for (const fileMatch of value.matches) {
		if (hasMoreMatches) break;
		const lines: ContentMatch[] = [];
		let pendingContext: ContentMatch[] = [];
		for (const line of fileMatch.matches) {
			if (line.isContextLine) {
				if (lines.length > 0) lines.push(line);
				else pendingContext.push(line);
				continue;
			}
			if (skipped < offset) {
				skipped++;
				pendingContext = [];
				continue;
			}
			if (collected >= limit) {
				hasMoreMatches = true;
				break;
			}
			lines.push(...pendingContext);
			pendingContext = [];
			lines.push(line);
			collected++;
		}
		if (lines.length > 0) matches.push({ file: fileMatch.file, matches: lines });
	}
	return {
		...value,
		matches,
		clientTruncated: value.clientTruncated || hasMoreMatches,
		headLimitApplied: headLimit,
		offsetApplied: offset > 0 ? offset : undefined,
	};
}

// head_limit and offset cut the page after the search ran.
export function applyPagination(union: SearchUnion, offset: number, headLimit: number | undefined): SearchUnion {
	if (offset === 0 && headLimit === undefined) return union;
	const pageInfo = { headLimitApplied: headLimit, offsetApplied: offset > 0 ? offset : undefined };
	switch (union.mode) {
		case "content":
			return { mode: "content", value: paginateContent(union.value, offset, headLimit) };
		case "files_with_matches": {
			const page = paginateArray(union.value.files, offset, headLimit);
			return { mode: "files_with_matches", value: { ...union.value, files: page.items, clientTruncated: union.value.clientTruncated || page.truncated, ...pageInfo } };
		}
		case "count": {
			const page = paginateArray(union.value.counts, offset, headLimit);
			return { mode: "count", value: { ...union.value, counts: page.items, clientTruncated: union.value.clientTruncated || page.truncated, ...pageInfo } };
		}
	}
}

function sameSearch(a: SearchKey, b: SearchKey): boolean {
	return (
		a.pattern === b.pattern &&
		a.path === b.path &&
		a.glob === b.glob &&
		(a.outputMode ?? "content") === (b.outputMode ?? "content") &&
		a.type === b.type &&
		a.caseInsensitive === b.caseInsensitive &&
		a.multiline === b.multiline &&
		a.contextBefore === b.contextBefore &&
		a.contextAfter === b.contextAfter &&
		a.context === b.context
	);
}

export interface SearchKey {
	pattern: string;
	path?: string;
	glob?: string;
	type?: string;
	outputMode?: OutputMode;
	caseInsensitive: boolean;
	multiline: boolean;
	contextBefore?: number;
	contextAfter?: number;
	context?: number;
}

// The last five full (unpaginated) results, most recent first.
export class SearchResultCache {
	private entries: { args: SearchKey; result: SearchSuccess }[] = [];

	constructor(private readonly capacity = 5) {}

	get(args: SearchKey): SearchSuccess | undefined {
		const index = this.entries.findIndex((entry) => sameSearch(entry.args, args));
		if (index === -1) return undefined;
		const [entry] = this.entries.splice(index, 1);
		this.entries.unshift(entry);
		return entry.result;
	}

	set(args: SearchKey, result: SearchSuccess): void {
		const existing = this.entries.findIndex((entry) => sameSearch(entry.args, args));
		if (existing !== -1) this.entries.splice(existing, 1);
		else if (this.entries.length >= this.capacity) this.entries.pop();
		this.entries.unshift({ args, result });
	}
}

export interface GlobResult {
	path: string | undefined;
	files: string[];
	totalFiles: number;
	clientTruncated: boolean;
	ripgrepTruncated: boolean;
}

// File paths relative to the requested folder.
export function mapToGlob(success: SearchSuccess): GlobResult | undefined {
	if (success.union.mode !== "files_with_matches") return undefined;
	const value = success.union.value;
	const requested = success.path;
	const files =
		requested === undefined || requested === ""
			? value.files
			: value.files.map((file) => {
					const absolute = resolve(success.root, file);
					const target = isAbsolute(requested) ? requested : resolve(success.root, requested);
					return relative(target, absolute) || basename(absolute);
				});
	return { path: requested, files, totalFiles: value.totalFiles, clientTruncated: value.clientTruncated, ripgrepTruncated: value.ripgrepTruncated };
}

function truncationNotice(totalFiles: number, ripgrepTruncated: boolean): string {
	const count = `${totalFiles} file${totalFiles === 1 ? "" : "s"}`;
	const total = totalFiles > 0 ? ` ${ripgrepTruncated ? `At least ${count}` : count} in total.` : "";
	return `[Results truncated.${total} Narrow the search with a more specific target_directory or glob_pattern.]\n`;
}

// Listing of a successful glob result.
export function formatGlob(result: GlobResult, searchRoot: string): string {
	const normalizedRoot = searchRoot.replace(/\/$/, "");
	const files = normalizedRoot === "." ? result.files.map((file) => file.replace(/^\.\//, "")) : result.files;
	let text = "";
	let listedAll = true;
	if (files.length === 0) {
		text += `Result of search in '${searchRoot}': 0 files found\n`;
	} else {
		text += `Result of search in '${searchRoot}'`;
		if (!result.ripgrepTruncated) text += ` (total ${result.totalFiles} file${result.totalFiles === 1 ? "" : "s"})`;
		text += ":\n";
		for (let i = 0; i < files.length; i++) {
			const file = files[i];
			if (text.length + file.length > GLOB_CHAR_BUDGET) {
				const remaining = Math.max(0, result.totalFiles - i);
				text += result.ripgrepTruncated
					? `... at least ${remaining} more files ... (Do a more specific search if needed)\n`
					: `... ${remaining} more files ... (Do a more specific search if needed)\n`;
				listedAll = false;
				break;
			}
			text += `- ${file}\n`;
		}
	}
	if (listedAll && files.length > 0 && (result.ripgrepTruncated || result.clientTruncated)) {
		text += truncationNotice(result.totalFiles, result.ripgrepTruncated);
	}
	return text;
}
