import { homedir } from "node:os";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import { goalLabel } from "./cards";
import type { CallResult } from "./state";

/** Plain row model; colors are applied in tools.ts. */
export interface Row {
	verb: string;
	detail: string;
	added?: number;
	removed?: number;
	files: number;
	searches: number;
	/** Other tool calls: lsp, eval, memory, MCP, goal get and resume. */
	tools?: number;
	/** Shell commands. */
	commands?: number;
}

export interface Line {
	tone: "dim" | "text" | "added" | "removed";
	text: string;
}

export type Status = "running" | "error" | "done";

/** Tools that keep their own row: edits and writes, and the cards of todo, ask, task and wait. */
const OWN_ROW_TOOLS: Record<string, true | undefined> = {
	todo: true,
	ask: true,
	task: true,
	wait: true,
	write: true,
	edit: true,
	ast_edit: true,
	apply_patch: true,
};

/** Whether a tool call joins an Explored run: every tool that keeps no row of its own, and goal get and resume. */
export function joinsRun(toolName: string, args: unknown): boolean {
	if (OWN_ROW_TOOLS[toolName] === true) return false;
	if (toolName === "goal") {
		const op = asRecord(args).op;
		return op === "get" || op === "resume";
	}
	return true;
}

/** Edit tools: each result carries a path and a diff. */
export function isEditTool(toolName: string): boolean {
	return toolName === "edit" || toolName === "ast_edit" || toolName === "apply_patch";
}

function asRecord(value: unknown): Record<string, unknown> {
	if (typeof value !== "object" || value === null) return {};
	return Object.fromEntries(Object.entries(value));
}

function str(value: unknown): string {
	return typeof value === "string" ? value : "";
}

/** A path shown relative to the working directory when inside it, else with a leading home directory as "~". */
export function displayPath(file: string): string {
	if (file === "") return file;
	const cwd = process.cwd();
	const absolute = resolve(cwd, file);
	const inside = relative(cwd, absolute);
	if (inside !== "" && inside !== ".." && !inside.startsWith(`..${sep}`) && !isAbsolute(inside)) return inside;
	const home = homedir();
	if (home !== "" && (absolute === home || absolute.startsWith(`${home}${sep}`))) return `~${absolute.slice(home.length)}`;
	return file;
}

function lines(text: string): string[] {
	const out = text.split("\n");
	while (out.length > 0 && out[out.length - 1] === "") out.pop();
	return out;
}

/** Lines of written content: the final newline ends the last line, and blank lines count. */
function writeLineCount(text: string): number {
	if (text === "") return 0;
	const out = text.split("\n");
	if (text.endsWith("\n")) out.pop();
	return out.length;
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
	const fromDetails = results
		.flatMap(r => {
			const details = asRecord(r.details);
			const perFile = Array.isArray(details.perFileResults)
				? details.perFileResults.map(entry => str(asRecord(entry).path))
				: [];
			return [str(details.path), ...perFile];
		})
		.filter(Boolean);
	if (fromDetails.length > 0) return fromDetails;
	const direct = str(args.path) || str(args.file_path);
	if (direct) return [direct];
	const input = str(args.input);
	return [...input.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)].map(match => (match[1] ?? "").trim());
}

/** The results of an edit call that each carry a path, when there are more than one; otherwise none. */
export function editResults(toolName: string, results: CallResult[]): CallResult[] {
	if (!isEditTool(toolName)) return [];
	const entries: CallResult[] = [];
	for (const result of results) {
		const details = asRecord(result.details);
		if (Array.isArray(details.perFileResults)) {
			for (const entry of details.perFileResults) {
				const item = asRecord(entry);
				if (typeof item.path !== "string") continue;
				entries.push({
					content: [],
					isError: item.isError === true,
					details: { path: item.path, diff: str(item.diff) },
				});
			}
		} else if (str(details.path) !== "") {
			entries.push(result);
		}
	}
	return entries.length > 1 ? entries : [];
}

/** The row of one edit result: its own path and its own +N −M. */
export function editResultRow(result: CallResult): Row {
	const totals = diffTotals([result]);
	return {
		verb: "Edited",
		detail: displayPath(str(asRecord(result.details).path)),
		added: totals.added,
		removed: totals.removed,
		files: 0,
		searches: 0,
	};
}

function search(verb: string, detail: string): Row {
	return { verb, detail, files: 0, searches: 1 };
}

/** A row of one other tool call. */
function tool(verb: string, detail: string): Row {
	return { verb, detail, files: 0, searches: 0, tools: 1 };
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
	return { verb: "Read", detail: `${displayPath(file)}${range}`, files: 1, searches: 0 };
}

/** The N of a result text that starts with "Found N results", else undefined. */
function resultCount(results: CallResult[]): number | undefined {
	for (const result of results) {
		const text = result.content
			.filter(c => c.type === "text")
			.map(c => c.text ?? "")
			.join("\n");
		const match = /^Found (\d+) results/.exec(text);
		if (match) return Number(match[1]);
	}
	return undefined;
}

/** The files of a write call with the line count of each content: its files batch, else its one path. */
export function writeFiles(args: unknown): Array<{ path: string; added: number }> {
	const a = asRecord(args);
	if (Array.isArray(a.files) && a.files.length > 0) {
		return a.files.map(item => {
			const file = asRecord(item);
			return { path: str(file.path), added: writeLineCount(str(file.content)) };
		});
	}
	return [{ path: str(a.path) || str(a.file_path), added: writeLineCount(str(a.content)) }];
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
			return tool("Inspected", [str(a.action), str(a.symbol) || str(a.file) || str(a.path)].filter(Boolean).join(" "));
		case "web_search":
			return search("Searched web", str(a.query));
		case "think":
			return tool("Noted", str(a.thoughts).split("\n", 1)[0] ?? "");
		case "wait":
			return tool("Waited", firstString(a));
		case "yield": {
			const data = yieldData(a, results);
			return tool("Returned", data === undefined ? "" : JSON.stringify(data));
		}
		case "edit":
		case "ast_edit":
		case "apply_patch": {
			const row: Row = {
				verb: "Edited",
				detail: editPaths(a, results)
					.map(file => displayPath(file))
					.join(", "),
				files: 0,
				searches: 0,
			};
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
				detail: displayPath(str(a.path) || str(a.file_path)),
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
				commands: 1,
			};
		case "eval":
			return tool("Ran eval", str(a.title) || str(a.language));
		case "lcm_grep": {
			const found = resultCount(results);
			const count = found === undefined ? "" : ` · ${found} found`;
			return tool("Searched memory", `"${str(a.query)}"${count}`);
		}
		case "lcm_describe":
			return tool("Viewed memory map", "");
		case "lcm_expand":
			return tool("Opened memory summary", "");
		case "goal":
			return tool(goalLabel(str(a.op)), "");
		default: {
			return tool(toolName, firstString(a));
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

/** Expanded body of a standalone row. */
export function bodyOf(toolName: string, args: unknown, results: CallResult[]): Line[] {
	switch (toolName) {
		case "edit":
		case "ast_edit":
		case "apply_patch":
			return diffLines(results);
		case "bash": {
			const command: Line[] = str(asRecord(args).command)
				.split("\n")
				.map((text, index) => ({ tone: "text", text: `${index === 0 ? "$ " : "  "}${text}` }));
			return [...command, ...outputLines(results)];
		}
		case "eval":
		case "lcm_grep":
		case "lcm_describe":
		case "lcm_expand":
			return outputLines(results);
		default:
			return [];
	}
}

/** "2 files, 1 search, 3 tools, ran 2 commands" without the verb: the nonzero parts in that order. */
export function countsText(files: number, searches: number, tools: number, commands: number): string {
	const parts: string[] = [];
	if (files > 0) parts.push(`${files} ${files === 1 ? "file" : "files"}`);
	if (searches > 0) parts.push(`${searches} ${searches === 1 ? "search" : "searches"}`);
	if (tools > 0) parts.push(`${tools} ${tools === 1 ? "tool" : "tools"}`);
	if (commands > 0) parts.push(`ran ${commands} ${commands === 1 ? "command" : "commands"}`);
	return parts.join(", ");
}

/** The first path in a tool call's args: its path, the first file of a batch, or the first file of a patch. */
function firstPath(a: Record<string, unknown>): string {
	const first = Array.isArray(a.files) ? asRecord(a.files[0]).path : undefined;
	const firstEdit = Array.isArray(a.edits) ? asRecord(a.edits[0]).path : undefined;
	const firstBatchPath = Array.isArray(a.paths) ? a.paths[0] : undefined;
	const patch = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/m.exec(str(a.input));
	return str(a.path) || str(a.file_path) || str(first) || str(firstEdit) || str(firstBatchPath) || (patch?.[1] ?? "").trim();
}

/** The phrase a status line shows while a tool call runs. */
export function actionPhrase(toolName: string, args: unknown): string {
	const path = firstPath(asRecord(args)).replace(/:\d+(?:[-+]\d*)?$/, "");
	const name = path === "" ? "" : basename(path);
	switch (toolName) {
		case "read":
			return name === "" ? "Reading file" : `Reading ${name}`;
		case "grep":
		case "glob":
		case "find":
		case "ast_grep":
			return "Searching files";
		case "web_search":
			return "Searching the web";
		case "lsp":
			return "Inspecting code";
		case "bash":
			return "Running command";
		case "eval":
			return "Running code";
		case "edit":
		case "ast_edit":
		case "apply_patch":
			return name === "" ? "Editing file" : `Editing ${name}`;
		case "write":
			return name === "" ? "Writing file" : `Writing ${name}`;
		case "todo":
			return "Updating to-do list";
		case "goal":
			return "Updating goal";
		case "task":
		case "wait":
			return "Waiting for subagent";
		case "ask":
			return "Waiting for your answer";
		default:
			return `Running ${toolName}`;
	}
}

/** Seconds with one decimal under 10 s, whole seconds under a minute, then m and s. */
export function formatElapsed(ms: number): string {
	const safe = Math.max(0, ms);
	if (safe < 10_000) return `${(safe / 1000).toFixed(1)}s`;
	const total = Math.floor(safe / 1000);
	if (total < 60) return `${total}s`;
	return `${Math.floor(total / 60)}m ${String(total % 60).padStart(2, "0")}s`;
}
