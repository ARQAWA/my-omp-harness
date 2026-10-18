// Argument checks for the tools whose Cursor schema is a zod object. Pi passes arguments through unchecked, so each tool runs
// these before anything else. Each issue carries zod's path and message, and invalidArguments renders them the way Cursor's
// parseJsonArgsWithZodSchema does, so the model reads the same text.

export type ArgType = "string" | "number" | "boolean" | "object" | "array";

export interface ArgIssue {
	path: (string | number)[];
	message: string;
}

// zod's name for a value's type, as in "Expected string, received number".
function receivedName(value: unknown): string {
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

// Records zod's issue when a value does not have the type ("Required" when it is absent); returns whether it does.
export function checkType(value: unknown, type: ArgType, path: ArgIssue["path"], issues: ArgIssue[]): boolean {
	if (hasType(value, type)) return true;
	issues.push({ path, message: value === undefined ? "Required" : `Expected ${type}, received ${receivedName(value)}` });
	return false;
}

// Cursor's parseJsonArgsWithZodSchema message: one "path: message" line per issue, "argument" for the whole value.
export function invalidArguments(issues: ArgIssue[]): string {
	const lines = issues.map((issue) => `${issue.path.length > 0 ? issue.path.join(".") : "argument"}: ${issue.message}`);
	return `Invalid arguments:\n${lines.join("\n")}`;
}

// An optional field: an absent value stays absent, and a present one, null included, must have the type.
export function optionalString(value: unknown, path: ArgIssue["path"], issues: ArgIssue[]): string | undefined {
	if (value === undefined) return undefined;
	return checkType(value, "string", path, issues) ? (value as string) : undefined;
}

export function optionalBoolean(value: unknown, path: ArgIssue["path"], issues: ArgIssue[]): boolean | undefined {
	if (value === undefined) return undefined;
	return checkType(value, "boolean", path, issues) ? (value as boolean) : undefined;
}

export function optionalNumber(value: unknown, path: ArgIssue["path"], issues: ArgIssue[]): number | undefined {
	if (value === undefined) return undefined;
	return checkType(value, "number", path, issues) ? (value as number) : undefined;
}

// zod's enum: a value that is not a string gets the type message, and a string outside the options gets the enum message.
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

// Cursor's lenientNumber: a numeric string is read as its number; anything else reaches the number check unchanged.
function lenientNumber(value: unknown): unknown {
	if (typeof value !== "string") return value;
	const trimmed = value.trim();
	if (trimmed === "") return value;
	const num = Number(trimmed);
	return Number.isNaN(num) ? value : num;
}

// An optional lenient number, with zod's minimum when one is given.
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

// Cursor's coerceBooleanLike for a flag with a default of false: null and an absent value read as false, the spellings above
// read as booleans, and anything else must already be a boolean.
export function booleanLike(value: unknown, path: ArgIssue["path"], issues: ArgIssue[]): boolean {
	if (value === null) return false;
	const spelled = BOOLEAN_SPELLINGS.get(typeof value === "string" ? value.trim().toLowerCase() : value);
	const read = spelled ?? value;
	if (read === undefined) return false;
	if (typeof read === "boolean") return read;
	checkType(read, "boolean", path, issues);
	return false;
}

// Cursor's lenientArray for an array-of-objects field: a string that holds a JSON array is read as that array. Cursor's repair
// also unwraps the array from leaked <parameter name="field"> markup, and accepts closing brackets, commas or whitespace after
// the array. Cursor's repair for arrays of primitives is not used by these tools and is not ported.
export function lenientArray(value: unknown, field: string): unknown {
	if (typeof value !== "string") return value;
	return repairStringifiedArray(value, field) ?? value;
}

type JsonToken = { kind: "string"; raw: string; index: number } | { kind: "punctuation"; char: string; index: number };

// Cursor's jsonTokens: the string literals and structural characters from start on, skipping everything else.
export function* jsonTokens(text: string, start: number): Generator<JsonToken> {
	for (let index = start; index < text.length; index++) {
		const char = text[index];
		if (char === '"') {
			const openIndex = index;
			let escaped = false;
			index++;
			while (index < text.length) {
				const inner = text[index];
				if (escaped) escaped = false;
				else if (inner === "\\") escaped = true;
				else if (inner === '"') break;
				index++;
			}
			yield { kind: "string", raw: text.slice(openIndex, index + 1), index: openIndex };
		} else if (char === "{" || char === "}" || char === "[" || char === "]" || char === ":" || char === ",") {
			yield { kind: "punctuation", char, index };
		}
	}
}

function decodeStringLiteral(raw: string): string {
	try {
		const decoded: unknown = JSON.parse(raw);
		return typeof decoded === "string" ? decoded : raw;
	} catch {
		return raw;
	}
}

// Cursor's namesAKeyTwice: true when an object in the JSON text names a key twice.
export function namesAKeyTwice(text: string): boolean {
	const containers: ("object" | "array")[] = [];
	const keysPerObject: Set<string>[] = [];
	let pendingString: string | undefined;
	for (const token of jsonTokens(text, 0)) {
		if (token.kind === "string") {
			pendingString = token.raw;
			continue;
		}
		switch (token.char) {
			case "{":
				containers.push("object");
				keysPerObject.push(new Set());
				break;
			case "[":
				containers.push("array");
				break;
			case "}":
				if (containers.pop() === "object") keysPerObject.pop();
				break;
			case "]":
				containers.pop();
				break;
			case ":":
				if (containers[containers.length - 1] === "object" && pendingString !== undefined) {
					const key = decodeStringLiteral(pendingString);
					const seen = keysPerObject[keysPerObject.length - 1];
					if (seen !== undefined) {
						if (seen.has(key)) return true;
						seen.add(key);
					}
				}
				break;
			default:
				break;
		}
		pendingString = undefined;
	}
	return false;
}

// Cursor's parseWholeArray: the whole text as a JSON array, or undefined.
function parseWholeArray(text: string): unknown[] | undefined {
	if (namesAKeyTwice(text)) return undefined;
	try {
		const parsed: unknown = JSON.parse(text);
		return Array.isArray(parsed) ? parsed : undefined;
	} catch {
		return undefined;
	}
}

// Cursor's decodeLeadingJsonArray: the array that starts the text, with the text that follows it.
function decodeLeadingJsonArray(blob: string): { value: unknown[]; rest: string } | undefined {
	const start = blob.indexOf("[");
	if (start < 0) return undefined;
	let depth = 0;
	for (const token of jsonTokens(blob, start)) {
		if (token.kind !== "punctuation") continue;
		if (token.char === "[" || token.char === "{") depth++;
		else if ((token.char === "]" || token.char === "}") && --depth === 0) {
			const value = parseWholeArray(blob.slice(start, token.index + 1));
			return value === undefined ? undefined : { value, rest: blob.slice(token.index + 1) };
		}
	}
	return undefined;
}

// Cursor's leaked-parameter markup: <parameter name="field">value</parameter>, with or without the antml prefix.
const LEAKED_PARAMETER = /<(?:antml:)?parameter\s+name="([^"]+)"\s*>([\s\S]*?)(?=<(?:antml:)?parameter\b|<\/|$)/gi;

// Cursor's repairStringifiedArray for a field of objects: the array the text holds, or undefined when no reading yields one.
function repairStringifiedArray(value: string, field: string): unknown[] | undefined {
	const trimmed = value.trim();
	if (trimmed === "") return undefined;
	const direct = parseWholeArray(trimmed);
	if (direct !== undefined) return direct;
	const leaks = [...trimmed.matchAll(LEAKED_PARAMETER)];
	if (leaks.length > 0) {
		const mine = leaks.filter((match) => match[1] === field);
		if (mine.length === 1 && leaks.every((match) => match[1] === field)) return parseWholeArray((mine[0]?.[2] ?? "").trim());
		return undefined;
	}
	if (trimmed.startsWith("[")) {
		const leading = decodeLeadingJsonArray(trimmed);
		if (leading !== undefined && /^[\s,\]}]*$/.test(leading.rest)) return leading.value;
	}
	return undefined;
}
