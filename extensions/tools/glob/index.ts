import type { ExtensionAPI, ExtensionToolContext } from "@oh-my-pi/pi-coding-agent";
import { classifyRipgrepMessage, searchWorkspace } from "../../shared/search/engine.ts";
import { formatGlob, GLOB_CHAR_BUDGET, mapToGlob, toolText, truncateOutput, type ToolText } from "../../shared/search/format.ts";
import { type ArgIssue, checkType, invalidArguments, optionalString, sortedSchema } from "../../shared/validate.ts";
import description from "./description.md" with { type: "text" };
import { todoJsonParameters } from "../../shared/todo-ops.ts";

const PARAMETERS = {
	type: "object",
	properties: {
		glob_pattern: {
			type: "string",
			description:
				'The glob pattern to match files against.\nPatterns not starting with "**/" are automatically prepended with "**/" to enable recursive searching.\n\nExamples:\n\t- "*.js" (becomes "**/*.js") - find all .js files\n\t- "**/node_modules/**" - find all node_modules directories\n\t- "**/test/**/test_*.ts" - find all test_*.ts files in any test directory',
		},
		target_directory: {
			type: "string",
			description: "Absolute path to directory to search for files in. If not provided, defaults to the workspace root.",
		},
	},
	required: ["glob_pattern"],
};

interface GlobParams {
	glob_pattern: string;
	target_directory?: string;
}

/** target_directory is an optional string and glob_pattern a required one; unknown keys are dropped. */
function parseGlobArgs(params: unknown): { args: GlobParams } | { error: string } {
	const issues: ArgIssue[] = [];
	if (!checkType(params, "object", [], issues)) return { error: invalidArguments(issues) };
	const input = params as Record<string, unknown>;
	const targetDirectory = optionalString(input.target_directory, ["target_directory"], issues);
	const globPattern = checkType(input.glob_pattern, "string", ["glob_pattern"], issues) ? (input.glob_pattern as string) : "";
	if (issues.length > 0) return { error: invalidArguments(issues) };
	return { args: { glob_pattern: globPattern, target_directory: targetDirectory } };
}

/** Forward slashes, no leading or trailing slash, and a **\/ prefix unless present. */
function normalizeGlob(glob: string): string {
	let result = glob.replace(/\\/g, "/");
	if (result.startsWith("/")) result = result.substring(1);
	if (result.endsWith("/")) result = result.substring(0, result.length - 1);
	if (!result.startsWith("**/")) result = `**/${result}`;
	return result;
}

export default function glob(pi: ExtensionAPI): void {
	const parameters = todoJsonParameters(pi, PARAMETERS, sortedSchema);
	pi.registerTool({
		name: "glob",
		label: "glob",
		loadMode: "essential",
		concurrency: "shared",
		strict: false,
		description: description.trim(),
		get parameters() {
			return parameters() as never;
		},
		execute: (_toolCallId, params, signal, _onUpdate, ctx) => executeGlob(params, signal, ctx),
	});
}

async function executeGlob(params: unknown, signal: AbortSignal | undefined, ctx: ExtensionToolContext): Promise<ToolText> {
	const parsed = parseGlobArgs(params);
	if ("error" in parsed) return toolText(truncateOutput(parsed.error, GLOB_CHAR_BUDGET), true);
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
		return toolText(truncateOutput(classifyRipgrepMessage(message), GLOB_CHAR_BUDGET), true);
	}
}
