import type { CallResult } from "./state";

/** Plain row model; colors are applied in tools.ts. */
export interface Row {
	verb: string;
	detail: string;
	added?: number;
	removed?: number;
	files: number;
	searches: number;
}

export interface Line {
	tone: "dim" | "text" | "added" | "removed";
	text: string;
}

export type Status = "running" | "error" | "done";

const DIFF_LIMIT = 20;
const OUTPUT_LIMIT = 20;
/** Tools that merge into an Explored row. */
export const EXPLORE_TOOLS: Record<string, true | undefined> = {
	read: true,
	grep: true,
	glob: true,
	find: true,
	ast_grep: true,
	lsp: true,
	web_search: true,
};

function asRecord(value: unknown): Record<string, unknown> {
	if (typeof value !== "object" || value === null) return {};
	return Object.fromEntries(Object.entries(value));
}

function str(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function lines(text: string): string[] {
	const out = text.split("\n");
	while (out.length > 0 && out[out.length - 1] === "") out.pop();
	return out;
}

function outputLines(results: CallResult[]): Line[] {
	const text = results.flatMap(r => r.content.filter(c => c.type === "text").map(c => c.text ?? "")).join("\n");
	return lines(text).map(text => ({ tone: "dim", text }));
}

function diffLines(results: CallResult[]): Line[] {
	const diff = results.map(r => str(asRecord(r.details).diff)).filter(Boolean).join("\n");
	return lines(diff).map(text => ({
		tone: text.startsWith("+") ? "added" : text.startsWith("-") ? "removed" : "dim",
		text,
	}));
}

/** Keeps the first `limit` lines and adds a notice for the rest. */
function headCut(body: Line[], limit: number): Line[] {
	if (body.length <= limit) return body;
	return [...body.slice(0, limit), { tone: "dim", text: `… ещё ${body.length - limit} строк` }];
}

/** Adds a notice for the cut head, then keeps the last `limit` lines. */
function tailCut(body: Line[], limit: number): Line[] {
	if (body.length <= limit) return body;
	return [{ tone: "dim", text: `… ещё ${body.length - limit} строк` }, ...body.slice(-limit)];
}

function diffTotals(results: CallResult[]): { added: number; removed: number } {
	let added = 0;
	let removed = 0;
	for (const result of results) {
		for (const line of lines(str(asRecord(result.details).diff))) {
			if (line.startsWith("+") && !line.startsWith("+++")) added++;
			else if (line.startsWith("-") && !line.startsWith("---")) removed++;
		}
	}
	return { added, removed };
}

function editPaths(args: Record<string, unknown>, results: CallResult[]): string[] {
	const fromDetails = results.map(r => str(asRecord(r.details).path)).filter(Boolean);
	if (fromDetails.length > 0) return fromDetails;
	const direct = str(args.path) || str(args.file_path);
	if (direct) return [direct];
	const input = str(args.input);
	return [...input.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)].map(match => (match[1] ?? "").trim());
}

function search(verb: string, detail: string): Row {
	return { verb, detail, files: 0, searches: 1 };
}

/** The first non-empty string argument, in argument order. */
function firstString(a: Record<string, unknown>): string {
	const first = Object.values(a).find(value => typeof value === "string" && value.length > 0);
	return typeof first === "string" ? first : "";
}

/** The data a yield submits: the first result's data, else the call's data. */
function yieldData(a: Record<string, unknown>, results: CallResult[]): unknown {
	const fromResult = results[0] ? asRecord(results[0].details).data : undefined;
	return fromResult !== undefined ? fromResult : a.data;
}

/** Read row from a read call's args: a path selector or offset/limit gives the line range. */
export function readRow(args: unknown): Row {
	const a = asRecord(args);
	const raw = str(a.file_path) || str(a.path);
	const selector = raw.match(/:(\d+)(?:([-+])(\d+)?)?$/);
	let file = raw;
	let start: number | undefined;
	let end: number | undefined;
	if (selector) {
		file = raw.slice(0, selector.index);
		start = Number(selector[1]);
		const count = selector[3] === undefined ? undefined : Number(selector[3]);
		if (selector[2] === "+" && count !== undefined) end = start + count - 1;
		if (selector[2] === "-") end = count;
	} else if (typeof a.offset === "number") {
		start = a.offset;
		if (typeof a.limit === "number") end = a.offset + a.limit - 1;
	}
	const range = start === undefined ? "" : end === undefined || end === start ? ` L${start}` : ` L${start}-${end}`;
	return { verb: "Read", detail: `${file}${range}`, files: 1, searches: 0 };
}

/** One-line description of a tool call and its results. */
export function rowOf(toolName: string, args: unknown, results: CallResult[]): Row {
	const a = asRecord(args);
	switch (toolName) {
		case "read":
			return readRow(args);
		case "grep":
			return search("Grepped", `${str(a.pattern)} in ${str(a.path) || "."}`);
		case "glob":
			return search("Searched files", str(a.glob_pattern) || str(a.pattern) || str(a.path));
		case "find":
			return search("Searched", str(a.query) || str(a.pattern));
		case "ast_grep":
			return search("Searched code", str(a.pat) || str(a.pattern));
		case "lsp":
			return search("Inspected", [str(a.action), str(a.symbol) || str(a.file) || str(a.path)].filter(Boolean).join(" "));
		case "web_search":
			return search("Searched web", str(a.query));
		case "think":
			return { verb: "Noted", detail: str(a.thoughts).split("\n", 1)[0] ?? "", files: 0, searches: 0 };
		case "wait":
			return { verb: "Waited", detail: firstString(a), files: 0, searches: 0 };
		case "yield": {
			const data = yieldData(a, results);
			return { verb: "Returned", detail: data === undefined ? "" : JSON.stringify(data), files: 0, searches: 0 };
		}
		case "edit":
		case "ast_edit": {
			const row: Row = { verb: "Edited", detail: editPaths(a, results).join(", "), files: 0, searches: 0 };
			if (results.length > 0) {
				const totals = diffTotals(results);
				row.added = totals.added;
				row.removed = totals.removed;
			}
			return row;
		}
		case "write":
			return {
				verb: "Wrote",
				detail: str(a.path) || str(a.file_path),
				added: lines(str(a.content)).length,
				files: 0,
				searches: 0,
			};
		case "bash":
			return {
				verb: "Ran",
				detail: str(a.command).replace(/\s*[\r\n]+\s*/g, " ").trim(),
				files: 0,
				searches: 0,
			};
		case "eval":
			return { verb: "Ran eval", detail: str(a.title) || str(a.language), files: 0, searches: 0 };
		default: {
			return { verb: toolName, detail: firstString(a), files: 0, searches: 0 };
		}
	}
}

/** Running until a final result arrives; error on error result or non-zero exit code. */
export function statusOf(results: CallResult[], isPartial: boolean): Status {
	if (isPartial || results.length === 0) return "running";
	const failed = results.some(r => {
		const exitCode = asRecord(r.details).exitCode;
		return r.isError === true || (typeof exitCode === "number" && exitCode !== 0);
	});
	return failed ? "error" : "done";
}

/** Expanded body of a standalone row, already capped. */
export function bodyOf(toolName: string, args: unknown, results: CallResult[]): Line[] {
	switch (toolName) {
		case "edit":
		case "ast_edit":
			return headCut(diffLines(results), DIFF_LIMIT);
		case "bash": {
			const command: Line[] = str(asRecord(args).command)
				.split("\n")
				.map((text, index) => ({ tone: "text", text: `${index === 0 ? "$ " : "  "}${text}` }));
			return [...command, ...tailCut(outputLines(results), OUTPUT_LIMIT)];
		}
		case "eval":
			return tailCut(outputLines(results), OUTPUT_LIMIT);
		default:
			return [];
	}
}

/** "2 files, 1 search" without the verb. */
export function countsText(files: number, searches: number): string {
	const parts: string[] = [];
	if (files > 0) parts.push(`${files} ${files === 1 ? "file" : "files"}`);
	if (searches > 0) parts.push(`${searches} ${searches === 1 ? "search" : "searches"}`);
	return parts.join(", ");
}

/** Seconds with one decimal under 10 s, whole seconds under a minute, then m and s. */
export function formatElapsed(ms: number): string {
	const safe = Math.max(0, ms);
	if (safe < 10_000) return `${(safe / 1000).toFixed(1)}s`;
	const total = Math.floor(safe / 1000);
	if (total < 60) return `${total}s`;
	return `${Math.floor(total / 60)}m ${String(total % 60).padStart(2, "0")}s`;
}
