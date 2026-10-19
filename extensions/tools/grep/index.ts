import type { ExtensionAPI, ExtensionToolContext } from "@oh-my-pi/pi-coding-agent";
import { classifyRipgrepMessage, searchWorkspace, type SearchRequest } from "../../shared/search/engine.ts";
import { applyPagination, formatSearchError, formatSearchResult, SearchResultCache, toolText, type ToolText } from "../../shared/search/format.ts";
import { sortedSchema } from "../../shared/validate.ts";
import { parseGrepArgs } from "./args.ts";
import description from "./description.md" with { type: "text" };
import { todoJsonParameters } from "../../shared/todo-ops.ts";

const MAX_INT32 = 2_147_483_647;
const searchCache = new SearchResultCache();

const PARAMETERS = {
	type: "object",
	properties: {
		pattern: { type: "string", description: "The regular expression pattern to search for in file contents" },
		path: { type: "string", description: "File or directory to search in (rg pattern -- PATH). Defaults to the workspace root." },
		glob: { type: "string", description: 'Glob pattern to filter files (e.g. "*.js", "*.{ts,tsx}") - maps to rg --glob' },
		output_mode: {
			type: "string",
			enum: ["content", "files_with_matches", "count"],
			description:
				'Output mode: "content" shows matching lines (supports -A/-B/-C context, -n line numbers, head_limit), "files_with_matches" shows file paths (supports head_limit), "count" shows match counts (supports head_limit). Defaults to "content".',
		},
		"-B": { type: "number", description: 'Number of lines to show before each match (rg -B). Requires output_mode: "content", ignored otherwise.' },
		"-A": { type: "number", description: 'Number of lines to show after each match (rg -A). Requires output_mode: "content", ignored otherwise.' },
		"-C": { type: "number", description: 'Number of lines to show before and after each match (rg -C). Requires output_mode: "content", ignored otherwise.' },
		"-i": { type: "boolean", description: "Case insensitive search (rg -i) Defaults to false" },
		type: { type: "string", description: "File type to search (rg --type). Common types: js, py, rust, go, java, etc. More efficient than glob for standard file types." },
		head_limit: {
			type: "number",
			minimum: 0,
			description: 'Limit output size. For "content" mode: limits total matches shown. For "files_with_matches" and "count" modes: limits number of files.',
		},
		offset: {
			type: "number",
			minimum: 0,
			description:
				'Skip first N entries. For "content" mode: skips first N matches. For "files_with_matches" and "count" modes: skips first N files. Use with head_limit for pagination.',
		},
		multiline: { type: "boolean", description: "Enable multiline mode where . matches newlines and patterns can span lines (rg -U --multiline-dotall). Default: false." },
	},
	required: ["pattern"],
};

/** Rounds the number and clamps it to 0..int32 max. */
function toInt32(value: number | undefined, round: (n: number) => number): number | undefined {
	if (value === undefined) return undefined;
	return Math.min(Math.max(round(value), 0), MAX_INT32);
}

export default function grep(pi: ExtensionAPI): void {
	const parameters = todoJsonParameters(pi, PARAMETERS, sortedSchema);
	pi.registerTool({
		name: "grep",
		label: "grep",
		loadMode: "essential",
		concurrency: "shared",
		strict: false,
		description: description.trim(),
		get parameters() {
			return parameters() as never;
		},
		execute: (_toolCallId, params, signal, _onUpdate, ctx) => executeGrep(params, signal, ctx),
	});
}

async function executeGrep(params: unknown, signal: AbortSignal | undefined, ctx: ExtensionToolContext): Promise<ToolText> {
	const parsed = parseGrepArgs(params);
	if ("error" in parsed) return toolText(formatSearchError(parsed.error), true);
	const args = parsed.args;
	try {
		if (args.pattern === "") throw new Error('pattern is empty. Pass "." to match every line.');
		for (const flag of ["-A", "-B", "-C"] as const) {
			const lines = args[flag];
			if (lines !== undefined && lines < 0) throw new Error(`${flag} is ${lines}. Pass 0 or more context lines.`);
		}
		const request: SearchRequest = {
			pattern: args.pattern,
			path: args.path,
			glob: args.glob,
			type: args.type,
			outputMode: args.output_mode ?? "content",
			caseInsensitive: args["-i"] === true,
			multiline: args.multiline === true,
			contextBefore: toInt32(args["-B"], Math.ceil),
			contextAfter: toInt32(args["-A"], Math.ceil),
			context: toInt32(args["-C"], Math.ceil),
		};
		const offset = toInt32(args.offset, Math.floor) ?? 0;
		const headLimit = toInt32(args.head_limit, Math.ceil) || undefined;
		// The last five full results are cached, so paging through one costs no new search.
		let success = searchCache.get(request);
		if (success === undefined) {
			success = await searchWorkspace(request, ctx.cwd, signal);
			searchCache.set(request, success);
		}
		return toolText(formatSearchResult({ ...success, union: applyPagination(success.union, offset, headLimit) }));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return toolText(formatSearchError(classifyRipgrepMessage(message, args.pattern)), true);
	}
}
