import { type ArgIssue, booleanLike, checkType, invalidArguments, optionalEnum, optionalLenientNumber, optionalString } from "../cursor-args.ts";
import type { OutputMode } from "./format.ts";

export interface RgParams {
	pattern: string;
	path?: string;
	glob?: string;
	output_mode?: OutputMode;
	"-B"?: number;
	"-A"?: number;
	"-C"?: number;
	"-i": boolean;
	type?: string;
	head_limit?: number;
	offset?: number;
	multiline: boolean;
}

const OUTPUT_MODES = ["content", "files_with_matches", "count"] as const;

// Cursor's rg schema, read in its key order. pattern is required; the context and paging numbers are lenient; the two flags
// accept boolean spellings, and a null or absent flag reads as false.
export function parseRgArgs(params: unknown): { args: RgParams } | { error: string } {
	const issues: ArgIssue[] = [];
	if (!checkType(params, "object", [], issues)) return { error: invalidArguments(issues) };
	const input = params as Record<string, unknown>;
	const pattern = checkType(input.pattern, "string", ["pattern"], issues) ? (input.pattern as string) : "";
	const path = optionalString(input.path, ["path"], issues);
	const glob = optionalString(input.glob, ["glob"], issues);
	const outputMode = optionalEnum(input.output_mode, OUTPUT_MODES, ["output_mode"], issues);
	const before = optionalLenientNumber(input["-B"], ["-B"], issues);
	const after = optionalLenientNumber(input["-A"], ["-A"], issues);
	const context = optionalLenientNumber(input["-C"], ["-C"], issues);
	const caseInsensitive = booleanLike(input["-i"], ["-i"], issues);
	const type = optionalString(input.type, ["type"], issues);
	const headLimit = optionalLenientNumber(input.head_limit, ["head_limit"], issues, 0);
	const offset = optionalLenientNumber(input.offset, ["offset"], issues, 0);
	const multiline = booleanLike(input.multiline, ["multiline"], issues);
	if (issues.length > 0) return { error: invalidArguments(issues) };
	return {
		args: {
			pattern,
			path,
			glob,
			output_mode: outputMode,
			"-B": before,
			"-A": after,
			"-C": context,
			"-i": caseInsensitive,
			type,
			head_limit: headLimit,
			offset,
			multiline,
		},
	};
}
