import type { ExtensionAPI, ExtensionToolContext } from "@oh-my-pi/pi-coding-agent";
import { declaration } from "./declarations.ts";
import { applyPagination, formatSearchError, formatSearchResult, SearchResultCache, toolText, type ToolText } from "./rg/format.ts";
import { parseRgArgs } from "./rg/args.ts";
import { classifyRipgrepMessage, searchWorkspace, type SearchRequest } from "./rg/search.ts";
import { VARIANT } from "./read-file.ts";

// Read step of the wave: whole definition files (base, expand) or code windows by grep line numbers (map).
const READ_STEP = VARIANT.startsWith("map")
	? "read the config, deploy and run files whole, and read code around the matching lines of definitions, configuration use and entrypoints with offset and limit"
	: "read with read without offset or limit the files whose matching lines show a definition, configuration or entrypoint of the subject, and those run files; read other hits only around their matching lines with offset and limit";

const RG = declaration("rg");
const MAX_INT32 = 2_147_483_647;
const searchCache = new SearchResultCache();

// Cursor's toGrepInt32: rounds the number and clamps it to 0..int32 max.
function toInt32(value: number | undefined, round: (n: number) => number): number | undefined {
	if (value === undefined) return undefined;
	return Math.min(Math.max(round(value), 0), MAX_INT32);
}

export function register(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "grep",
		label: "grep",
		loadMode: "essential",
		strict: false,
		description:
			`${RG.description}\n` +
			"- Search greedily in waves, broad first, then narrower. First response: several broad grep searches in parallel in content mode without head_limit, one per facet of the subject, each putting every name, synonym and spelling into one alternation, plus glob for the deploy, run and entrypoint files (compose, Dockerfile, Makefile, systemd, CI, main, bin, __main__). Each next response, in one batch: " +
			READ_STEP +
			"; continue longer files from the returned line; and grep the exact identifiers just found. Stop when every part of the question has an answer backed by a file and line, covering every implementation, caller and config key of the subject itself; do not follow the subject into neighbouring subsystems the question does not ask about.",
		parameters: RG.parameters as never,
		execute: (_toolCallId, params, signal, _onUpdate, ctx) => executeRg(params, signal, ctx),
	});
}

export async function executeRg(params: unknown, signal: AbortSignal | undefined, ctx: ExtensionToolContext): Promise<ToolText> {
	const parsed = parseRgArgs(params);
	// Cursor's rg reports an argument failure as its error text, without classifying it.
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
		// Cursor caches the full result of the last five searches; pagination runs on the cached result.
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
