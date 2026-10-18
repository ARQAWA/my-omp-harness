import { ReadToolError } from "./errors.ts";

// Longer output is replaced by a message that asks for offset and limit.
export const READ_CHAR_HARD_LIMIT = 100_000;
// Text is cut to this many characters before the line logic runs.
export const MAX_TEXT_SIZE = 8 * 1024 * 1024;

export interface ReadRange {
	startLine: number;
	endLine: number;
}

export interface TextRead {
	content: string;
	totalLines: number;
	rangeApplied: boolean;
}

function capText(text: string): string {
	return text.length > MAX_TEXT_SIZE ? text.slice(0, MAX_TEXT_SIZE) : text;
}

// Line reader over decoded text. A file whose line endings are at least 5% CRLF has its "\r"
// removed from every line that ends with a newline. A negative offset takes the last |offset| lines.
export function readTextRange(text: string, offset: number | undefined, limit: number | undefined): TextRead {
	const parts = text.split("\n");
	const totalLines = parts.length;
	let crlf = 0;
	let lf = 0;
	for (let i = 0; i < totalLines - 1; i++) {
		if (parts[i].endsWith("\r")) crlf++;
		else lf++;
	}
	const newlines = crlf + lf;
	const normalizeCrlf = newlines > 0 && (crlf / newlines) * 100 >= 5;
	const lines = parts.map((line, i) => (normalizeCrlf && i < totalLines - 1 && line.endsWith("\r") ? line.slice(0, -1) : line));
	const fullText = lines.join("\n");
	if (offset === undefined && limit === undefined) return { content: capText(fullText), totalLines, rangeApplied: false };
	if (fullText === "") return { content: "", totalLines, rangeApplied: false };
	const effectiveOffset = offset ?? 1;
	if (effectiveOffset < 0) {
		const capacity = Math.abs(effectiveOffset);
		const tail = lines.slice(Math.max(0, totalLines - capacity));
		return { content: capText(tail.slice(0, limit ?? capacity).join("\n")), totalLines, rangeApplied: true };
	}
	const start = Math.max(0, effectiveOffset - 1);
	if (start >= totalLines) return { content: capText(fullText), totalLines, rangeApplied: false };
	const end = limit === undefined ? totalLines : start + limit;
	return { content: capText(lines.slice(start, end).join("\n")), totalLines, rangeApplied: true };
}

// The lines an offset and limit select, or undefined when neither is given.
export function computeReadSlice(
	totalLines: number,
	offset: number | undefined,
	limit: number | undefined,
): { start: number; end: number; readRange: ReadRange } | undefined {
	if (offset === undefined && limit === undefined) return undefined;
	const effectiveOffset = offset ?? 1;
	const effectiveLimit = limit ?? (effectiveOffset < 0 ? Math.abs(effectiveOffset) : totalLines);
	const start = effectiveOffset < 0 ? Math.max(0, totalLines + effectiveOffset) : Math.max(0, effectiveOffset - 1);
	const end = Math.min(totalLines, start + effectiveLimit);
	if (start >= totalLines) {
		throw new ReadToolError(`Offset ${offset} is beyond file length (${totalLines} lines)`);
	}
	return { start, end, readRange: { startLine: start + 1, endLine: end } };
}

// The content without line numbers, with a "not shown" line above and below the range.
export function formatReadCodeBlock(content: string, range: ReadRange, totalLines: number): string {
	let result = content;
	if (range.startLine <= 1 && range.endLine >= totalLines) return result;
	if (range.startLine > 1) {
		const hidden = range.startLine - 1;
		result = `... ${hidden} ${hidden === 1 ? "line" : "lines"} not shown ...\n${result}`;
	}
	const endLine = range.startLine + content.split("\n").length - 1;
	if (totalLines > endLine) {
		const hidden = totalLines - endLine;
		result = `${result}\n... ${hidden} ${hidden === 1 ? "line" : "lines"} not shown ...`;
	}
	return result;
}
