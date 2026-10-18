import { readFile, stat } from "node:fs/promises";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { declaration } from "./declarations.ts";
import { parseReadFileArgs } from "./read-file/args.ts";
import { ReadToolError } from "./read-file/errors.ts";
import { computeReadSlice, formatReadCodeBlock, READ_CHAR_HARD_LIMIT, readTextRange } from "./read-file/lines.ts";
import { resolveReadPath, resolveRealPath } from "./read-file/paths.ts";
import { getEvalDocTopics } from "@oh-my-pi/pi-coding-agent/tools/eval";
import { enclosingBlockBoundaries, summarizeCodeAsync } from "@oh-my-pi/pi-natives";

// Cursor's ReadFile for text files, with a greedy first read: a file without offset and limit comes back whole up to
// FIRST_READ_LINES lines; a longer one returns its first lines and the offset to continue from.
const READ_FILE = declaration("ReadFile");
const FIRST_READ_LINES = 1000;
// Images and PDF go to omp's built-in read, which this tool replaces under the same name.
const NATIVE_READ_EXTENSIONS = /\.(png|jpe?g|gif|webp|pdf)$/i;
const INTERNAL_URL = /^[a-z][a-z0-9+.-]*:\/\//i;
// omp serves xd://eval/<topic> only for its built-in eval, so the eval wrapper's doc topics are served here.
const EVAL_TOPIC = /^xd:\/\/eval\/([\w-]+)$/;
const EVAL_TOPICS = getEvalDocTopics({ spawns: false, waitTool: false, eagerDelegation: false });
// Probe switch: base = text read as Cursor; expand = code windows grow to enclosing blocks; map = expand plus an
// outline for long code files read without a range.
export const VARIANT = process.env.OMPLITE_VARIANT ?? "expand";
const EXPAND = VARIANT !== "base";
const MAP = VARIANT.startsWith("map");
const CODE_EXTENSIONS = /\.(py|pyi|rs|go|java|kt|kts|scala|ts|tsx|js|jsx|mjs|cjs|c|h|cc|cpp|hpp|cs|rb|php|swift)$/i;
const MAP_MIN_LINES = 200;
const EXPAND_REACH = 150;
const UNSUPPORTED_BINARY_EXTENSIONS = /\.(zip|tar|gz|exe|dll|so|dylib|bin|mp4|webm|mov|avi|mkv|wmv|flv|m4v)$/i;

// Relative paths cost fewer output tokens than absolute ones; resolveReadPath already resolves them against the workspace.
const PARAMETERS = structuredClone(READ_FILE.parameters) as { properties: { path: { description: string } } };
PARAMETERS.properties.path.description = "Path of the file to read, relative to the workspace root (absolute paths also work).";

const DESCRIPTION =
	`${READ_FILE.description}\n` +
	`- Without offset and limit, a file of up to ${FIRST_READ_LINES} lines comes back whole; a longer file returns its first ${FIRST_READ_LINES} lines and the offset to continue from. ` +
	"Read every file that may relate to the subject in one response." +
	(EXPAND ? "\n- In code files a range grows to the enclosing function or block, so a window around a match shows the whole block." : "") +
	(MAP
		? `\n- A code file longer than ${MAP_MIN_LINES} lines read without offset and limit returns an outline: declarations and signatures with line numbers, bodies hidden. Read the bodies you need with offset and limit, all in one response. Config, docs and other text files come back whole.`
		: "");

export function register(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "read",
		label: "read",
		loadMode: "essential",
		strict: false,
		description: DESCRIPTION,
		parameters: PARAMETERS as never,
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const path = (params as { path?: unknown }).path;
			const topic = typeof path === "string" ? EVAL_TOPIC.exec(path)?.[1] : undefined;
			if (topic !== undefined && EVAL_TOPICS[topic] !== undefined) return text(EVAL_TOPICS[topic]);
			if (typeof path === "string" && ctx.invokeTool !== undefined) {
				// Internal URLs such as xd://eval/judge, which the eval description links to, are served only by omp's read.
				if (INTERNAL_URL.test(path)) return ctx.invokeTool({ path }, { signal, onUpdate });
				if (NATIVE_READ_EXTENSIONS.test(path)) return ctx.invokeTool({ path: resolveReadPath(path, ctx.cwd) }, { signal, onUpdate });
			}
			try {
				return text(await readPath(params, ctx.cwd));
			} catch (error) {
				// Cursor sends every failure back as result text, prefixed with "Error: ".
				return text(`Error: ${error instanceof Error ? error.message : String(error)}`, true);
			}
		},
	});
}

function text(value: string, isError = false) {
	return { content: [{ type: "text" as const, text: value }], details: undefined, ...(isError ? { isError: true as const } : {}) };
}

async function readPath(params: unknown, cwd: string): Promise<string> {
	const args = parseReadFileArgs(params);
	if (args.path.trim() === "") throw new ReadToolError("path is empty or only whitespace");
	const binary = UNSUPPORTED_BINARY_EXTENSIONS.exec(args.path);
	if (binary !== null) throw new ReadToolError(`Cannot read binary files of type ${binary[1]!.toLowerCase()}`);
	const file = resolveReadPath(args.path, cwd);
	const real = await resolveRealPath(file);
	if (real === null) throw new ReadToolError("Permission denied");
	let bytes: Buffer;
	try {
		const info = await stat(file);
		if (info.isDirectory()) throw new ReadToolError(`Path is a directory, not a file: ${args.path}`);
		if (!info.isFile()) throw new ReadToolError(`Path is neither a file nor a directory: ${args.path}`);
		bytes = await readFile(file);
	} catch (error) {
		if (error instanceof ReadToolError) throw error;
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "ENOENT") throw new ReadToolError("File not found");
		if (code === "EACCES" || code === "EPERM") throw new ReadToolError("Permission denied");
		throw new ReadToolError(error instanceof Error ? error.message : "Unknown error occurred");
	}
	if (bytes.subarray(0, 8000).includes(0)) throw new ReadToolError(`File content is binary data, not text: ${args.path}`);
	const content = bytes.toString("utf8");
	if (CODE_EXTENSIONS.test(file)) {
		if (MAP && args.offset === undefined && args.limit === undefined) {
			const outline = await outlineOf(content, file);
			if (outline !== undefined) return outline;
		}
		if (EXPAND && args.offset !== undefined && args.offset > 0) {
			const grown = growToBlocks(content, file, args.offset, args.limit);
			return render(content, grown.offset, grown.limit);
		}
	}
	return render(content, args.offset, args.limit);
}

// Widen [offset, offset+limit) to the enclosing block boundaries tree-sitter reports, at most EXPAND_REACH lines each way.
function growToBlocks(content: string, path: string, offset: number, limit: number | undefined) {
	const total = content.split("\n").length;
	const start = offset;
	const end = Math.min(total, limit === undefined ? total : offset + limit - 1);
	if (start > total) return { offset, limit };
	const bounds = enclosingBlockBoundaries({ code: content, path, ranges: [{ startLine: start, endLine: end }] });
	if (!bounds || bounds.length === 0) return { offset, limit };
	const up = bounds.filter(line => line < start && line >= start - EXPAND_REACH);
	const down = bounds.filter(line => line > end && line <= end + EXPAND_REACH);
	const newStart = up.length ? Math.min(...up) : start;
	const newEnd = down.length ? Math.max(...down) : end;
	return { offset: newStart, limit: newEnd - newStart + 1 };
}

// Outline of a long code file: kept lines with their numbers, hidden bodies as line ranges.
async function outlineOf(content: string, path: string): Promise<string | undefined> {
	const total = content.split("\n").length;
	if (total <= MAP_MIN_LINES) return undefined;
	const summary = await summarizeCodeAsync({ code: content, path, minBodyLines: 4, unfoldUntilLines: 200 });
	if (!summary.parsed || !summary.elided) return undefined;
	const out: string[] = [];
	for (const segment of summary.segments) {
		if (segment.kind !== "kept") {
			out.push(`     ... ${segment.startLine}-${segment.endLine} hidden`);
			continue;
		}
		(segment.text ?? "").split("\n").forEach((line, i) => out.push(`${String(segment.startLine + i).padStart(5)}|${line}`));
	}
	return `[Outline of a ${total}-line file: bodies hidden; read them with offset and limit.]\n${out.join("\n")}`;
}

function render(content: string, offset: number | undefined, limit: number | undefined): string {
	const read = readTextRange(content, offset, limit);
	if (read.content === "" && !read.rangeApplied) return "File is empty.";
	const total = read.totalLines;
	let lines = read.content.split("\n");
	let start = 1;
	if (read.rangeApplied) {
		start = computeReadSlice(total, offset, limit)?.readRange.startLine ?? 1;
	} else {
		const slice = computeReadSlice(total, offset, limit);
		if (slice !== undefined) {
			lines = lines.slice(slice.start, slice.end);
			start = slice.readRange.startLine;
		}
	}
	const greedyCut = offset === undefined && limit === undefined && lines.length > FIRST_READ_LINES;
	if (greedyCut) lines = lines.slice(0, FIRST_READ_LINES);
	if (lines.join("\n").length > READ_CHAR_HARD_LIMIT) {
		throw new ReadToolError(
			`Requested content exceeds maximum allowed characters (${READ_CHAR_HARD_LIMIT} characters). The file is ${Buffer.byteLength(content)} bytes.\nPlease use offset and limit parameters to read specific portions of the file, or use the 'grep' tool to search for specific content.`,
		);
	}
	const end = start + lines.length - 1;
	const body = formatReadCodeBlock(lines.join("\n"), { startLine: start, endLine: end }, total);
	return greedyCut ? `${body}\n[Use offset=${end + 1} to continue.]` : body;
}
