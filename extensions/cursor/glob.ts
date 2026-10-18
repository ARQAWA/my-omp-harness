import type { ExtensionAPI, ExtensionToolContext } from "@oh-my-pi/pi-coding-agent";
import { type ArgIssue, checkType, invalidArguments, optionalString } from "./cursor-args.ts";
import { declaration } from "./declarations.ts";
import { formatGlob, GLOB_CHAR_BUDGET, mapToGlob, toolText, truncateOutput, type ToolText } from "./rg/format.ts";
import { classifyRipgrepMessage, searchWorkspace } from "./rg/search.ts";

const GLOB = declaration("Glob");

interface GlobParams {
	glob_pattern: string;
	target_directory?: string;
}

// Cursor's Glob schema: target_directory is an optional string and glob_pattern a required one; unknown keys are dropped.
export function parseGlobArgs(params: unknown): { args: GlobParams } | { error: string } {
	const issues: ArgIssue[] = [];
	if (!checkType(params, "object", [], issues)) return { error: invalidArguments(issues) };
	const input = params as Record<string, unknown>;
	const targetDirectory = optionalString(input.target_directory, ["target_directory"], issues);
	const globPattern = checkType(input.glob_pattern, "string", ["glob_pattern"], issues) ? (input.glob_pattern as string) : "";
	if (issues.length > 0) return { error: invalidArguments(issues) };
	return { args: { glob_pattern: globPattern, target_directory: targetDirectory } };
}

// Cursor's normalizeGlob: forward slashes, no leading or trailing slash, and a **/ prefix unless present.
function normalizeGlob(glob: string): string {
	let result = glob.replace(/\\/g, "/");
	if (result.startsWith("/")) result = result.substring(1);
	if (result.endsWith("/")) result = result.substring(0, result.length - 1);
	if (!result.startsWith("**/")) result = `**/${result}`;
	return result;
}

export function register(pi: ExtensionAPI): void {
	pi.registerTool({
		// omp folds the name Glob into its built-in glob, so this tool replaces that built-in under its name.
		name: "glob",
		label: GLOB.name,
		loadMode: "essential",
		strict: false,
		description: GLOB.description,
		parameters: GLOB.parameters as never,
		execute: (_toolCallId, params, signal, _onUpdate, ctx) => executeGlob(params, signal, ctx),
	});
}

export async function executeGlob(params: unknown, signal: AbortSignal | undefined, ctx: ExtensionToolContext): Promise<ToolText> {
	const parsed = parseGlobArgs(params);
	// Cursor's Glob reports an argument failure as its error text, cut twice and never classified.
	if ("error" in parsed) return toolText(truncateOutput(truncateOutput(parsed.error, GLOB_CHAR_BUDGET), GLOB_CHAR_BUDGET), true);
	const args = parsed.args;
	try {
		const glob = normalizeGlob(args.glob_pattern);
		if (glob === "**/") throw new Error('glob_pattern is empty. Pass "*" to match every file.');
		const success = await searchWorkspace(
			{ pattern: "", path: args.target_directory, glob, outputMode: "files_with_matches", caseInsensitive: false, multiline: false },
			ctx.cwd,
			signal,
		);
		const result = mapToGlob(success);
		if (result === undefined) return toolText("glob_file_search didn't return the result");
		return toolText(formatGlob(result, result.path || "."));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		// Cursor cuts the message in serializeError and again in the formatter.
		return toolText(truncateOutput(truncateOutput(classifyRipgrepMessage(message), GLOB_CHAR_BUDGET), GLOB_CHAR_BUDGET), true);
	}
}
