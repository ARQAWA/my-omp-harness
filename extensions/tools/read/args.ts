import { lenientNumber, receivedName } from "../../shared/validate.ts";
import { ReadToolError } from "./errors.ts";

// Arguments of read. A negative offset counts back from the last line; 0 means the first line.
export interface ReadArgs {
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

function parseInteger(field: string, raw: unknown, issues: Issue[]): number | undefined {
	const value = lenientNumber(raw);
	if (value === undefined) return undefined;
	if (typeof value !== "number") {
		issues.push({ path: field, message: `Expected number, received ${receivedName(value)}` });
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

function invalidArguments(issues: Issue[]): ReadToolError {
	return new ReadToolError(`Invalid arguments:\n${issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n")}`);
}

export function parseReadArgs(params: unknown): ReadArgs {
	if (params === null || typeof params !== "object" || Array.isArray(params)) {
		throw invalidArguments([{ path: "argument", message: `Expected object, received ${receivedName(params)}` }]);
	}
	const record = params as Record<string, unknown>;
	const issues: Issue[] = [];
	let path = "";
	if (typeof record.path === "string") {
		path = record.path;
	} else {
		issues.push({ path: "path", message: record.path === undefined ? "Required" : `Expected string, received ${receivedName(record.path)}` });
	}
	const offset = parseInteger("offset", record.offset, issues);
	const limit = parseInteger("limit", record.limit, issues);
	if (limit !== undefined && limit < 1) issues.push({ path: "limit", message: "Limit must be >= 1." });
	if (issues.length > 0) throw invalidArguments(issues);
	return { path, offset: clampInt32(offset === 0 ? 1 : offset), limit: clampInt32(limit) };
}
