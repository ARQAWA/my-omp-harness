import { ReadToolError } from "./errors.ts";

// The arguments after Cursor's ReadFile schema. A negative offset counts back from the last line; 0 means the first line.
export interface ReadFileArgs {
	path: string;
	offset: number | undefined;
	limit: number | undefined;
}

const INT32_MAX = 2 ** 31 - 1;
const INT32_MIN = -(2 ** 31);

interface Issue {
	path: string;
	message: string;
}

function receivedType(value: unknown): string {
	if (value === null) return "null";
	if (Array.isArray(value)) return "array";
	return typeof value;
}

// Cursor's lenientNumber: a numeric string is read as a number; anything else reaches the integer check unchanged.
function lenientNumber(value: unknown): unknown {
	if (typeof value !== "string") return value;
	const trimmed = value.trim();
	if (trimmed === "") return value;
	const num = Number(trimmed);
	return Number.isNaN(num) ? value : num;
}

function parseInteger(field: string, raw: unknown, issues: Issue[]): number | undefined {
	const value = lenientNumber(raw);
	if (value === undefined) return undefined;
	if (typeof value !== "number") {
		issues.push({ path: field, message: `Expected number, received ${receivedType(value)}` });
		return undefined;
	}
	if (!Number.isInteger(value)) {
		issues.push({ path: field, message: "Expected integer, received float" });
		return undefined;
	}
	return value;
}

function clampInt32(value: number | undefined): number | undefined {
	return value === undefined ? undefined : Math.min(INT32_MAX, Math.max(INT32_MIN, value));
}

// Cursor reports a schema failure as "Invalid arguments:" with one "<field>: <message>" line per issue.
function invalidArguments(issues: Issue[]): ReadToolError {
	return new ReadToolError(`Invalid arguments:\n${issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n")}`);
}

export function parseReadFileArgs(params: unknown): ReadFileArgs {
	if (params === null || typeof params !== "object" || Array.isArray(params)) {
		throw invalidArguments([{ path: "argument", message: `Expected object, received ${receivedType(params)}` }]);
	}
	const record = params as Record<string, unknown>;
	const issues: Issue[] = [];
	let path = "";
	if (typeof record.path === "string") {
		path = record.path;
	} else {
		issues.push({ path: "path", message: record.path === undefined ? "Required" : `Expected string, received ${receivedType(record.path)}` });
	}
	const offset = parseInteger("offset", record.offset, issues);
	const limit = parseInteger("limit", record.limit, issues);
	if (limit !== undefined && limit < 1) issues.push({ path: "limit", message: "Limit must be >= 1." });
	if (issues.length > 0) throw invalidArguments(issues);
	return { path, offset: clampInt32(offset === 0 ? 1 : offset), limit: clampInt32(limit) };
}
