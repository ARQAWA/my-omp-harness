// Argument checks for tools with a raw JSON schema (strict: false): omp passes their arguments through unchecked, so each
// tool runs these first. invalidArguments renders the issues as "Invalid arguments:" with one "<field>: <message>" line each.

/** A JSON schema with its keys sorted at every level, the order these tools have always sent. */
export function sortedSchema(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sortedSchema);
	if (typeof value !== "object" || value === null) return value;
	const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
	return Object.fromEntries(entries.map(([key, inner]) => [key, sortedSchema(inner)]));
}

export type ArgType = "string" | "number" | "boolean" | "object" | "array";

export interface ArgIssue {
	path: (string | number)[];
	message: string;
}

/** Name of a value's type, as in "Expected string, received number". */
export function receivedName(value: unknown): string {
	if (value === null) return "null";
	if (Array.isArray(value)) return "array";
	if (typeof value === "number" && Number.isNaN(value)) return "nan";
	return typeof value;
}

function hasType(value: unknown, type: ArgType): boolean {
	switch (type) {
		case "string":
			return typeof value === "string";
		case "number":
			return typeof value === "number" && !Number.isNaN(value);
		case "boolean":
			return typeof value === "boolean";
		case "object":
			return typeof value === "object" && value !== null && !Array.isArray(value);
		case "array":
			return Array.isArray(value);
	}
}

/** Records an issue when a value does not have the type ("Required" when it is absent); returns whether it does. */
export function checkType(value: unknown, type: ArgType, path: ArgIssue["path"], issues: ArgIssue[]): boolean {
	if (hasType(value, type)) return true;
	issues.push({ path, message: value === undefined ? "Required" : `Expected ${type}, received ${receivedName(value)}` });
	return false;
}

/** One "path: message" line per issue, "argument" for the whole value. */
export function invalidArguments(issues: ArgIssue[]): string {
	const lines = issues.map((issue) => `${issue.path.length > 0 ? issue.path.join(".") : "argument"}: ${issue.message}`);
	return `Invalid arguments:\n${lines.join("\n")}`;
}

/** An optional field: an absent value stays absent, and a present one, null included, must have the type. */
export function optionalString(value: unknown, path: ArgIssue["path"], issues: ArgIssue[]): string | undefined {
	if (value === undefined) return undefined;
	return checkType(value, "string", path, issues) ? (value as string) : undefined;
}

/** An enum: a value that is not a string gets the type message, and a string outside the options gets the enum message. */
export function optionalEnum<T extends string>(value: unknown, options: readonly T[], path: ArgIssue["path"], issues: ArgIssue[]): T | undefined {
	if (value === undefined) return undefined;
	const expected = options.map((option) => `'${option}'`).join(" | ");
	if (typeof value !== "string") {
		issues.push({ path, message: `Expected ${expected}, received ${receivedName(value)}` });
		return undefined;
	}
	if (!(options as readonly string[]).includes(value)) {
		issues.push({ path, message: `Invalid enum value. Expected ${expected}, received '${value}'` });
		return undefined;
	}
	return value as T;
}

/** A numeric string is read as its number; anything else reaches the number check unchanged. */
export function lenientNumber(value: unknown): unknown {
	if (typeof value !== "string") return value;
	const trimmed = value.trim();
	if (trimmed === "") return value;
	const num = Number(trimmed);
	return Number.isNaN(num) ? value : num;
}

/** An optional lenient number, with a minimum when one is given. */
export function optionalLenientNumber(value: unknown, path: ArgIssue["path"], issues: ArgIssue[], min?: number): number | undefined {
	if (value === undefined) return undefined;
	const number = lenientNumber(value);
	if (!checkType(number, "number", path, issues)) return undefined;
	if (min !== undefined && (number as number) < min) {
		issues.push({ path, message: `Number must be greater than or equal to ${min}` });
		return undefined;
	}
	return number as number;
}

const BOOLEAN_SPELLINGS = new Map<unknown, boolean>([
	["true", true],
	["yes", true],
	["1", true],
	[1, true],
	["false", false],
	["no", false],
	["0", false],
	[0, false],
]);

/** A flag with a default of false: null and an absent value read as false, the spellings above read as booleans. */
export function booleanLike(value: unknown, path: ArgIssue["path"], issues: ArgIssue[]): boolean {
	if (value === null) return false;
	const spelled = BOOLEAN_SPELLINGS.get(typeof value === "string" ? value.trim().toLowerCase() : value);
	const read = spelled ?? value;
	if (read === undefined) return false;
	if (typeof read === "boolean") return read;
	checkType(read, "boolean", path, issues);
	return false;
}
