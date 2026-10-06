import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

const WIDTH = 60;

function wrapLine(text: string, width: number): string[] {
	if (text.length <= width) return [text];
	const suffix = text.match(/ {2,}$/)?.[0] ?? "";
	const body = suffix ? text.slice(0, -suffix.length) : text;
	const out: string[] = [];
	let cur = "";
	let previousEnd = 0;
	let empty = true;
	for (const match of body.matchAll(/\S+/g)) {
		const end = match.index + match[0].length;
		const word = match[0] + (end === body.length ? suffix : "");
		const gap = empty ? "" : body.slice(previousEnd, match.index);
		if (!empty && cur.length + gap.length + word.length > width) {
			out.push(cur);
			cur = word;
		} else {
			cur += gap + word;
		}
		previousEnd = end;
		empty = false;
	}
	out.push(cur);
	return out;
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const LIST = /^([ ]*)([-+*]|\d{1,9}[.)])([ \t]+)(.*)$/;
const QUOTE = /^ {0,3}>[ \t]?/;
const INDENTED = /^(?: {4}|\t)/;
const SETEXT = /^ {0,3}(?:=+|-+)[ \t]*$/;
const RULE = /^ {0,3}(?:-(?:[ \t]*-){2,}|\*(?:[ \t]*\*){2,}|_(?:[ \t]*_){2,})[ \t]*$/;
const HEADING = /^ {0,3}#{1,6}(?:[ \t]+|$)/;
const REFERENCE = /^ {0,3}\[[^\]]+\]:/;
const BLANK = /^[ \t]*$/;

function closesFence(line: string, fence: string): boolean {
	return new RegExp(`^ {0,3}${fence[0]}{${fence.length},}[ \\t]*$`).test(line);
}

function tableDelimiter(line: string): boolean {
	if (!line.includes("|")) return false;
	const cells = line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|");
	return cells.every(cell => /^[ \t]*:?-{3,}:?[ \t]*$/.test(cell));
}

function blockStart(lines: string[], i: number): boolean {
	const line = lines[i];
	return FENCE.test(line) || INDENTED.test(line) || HEADING.test(line) || SETEXT.test(line)
		|| RULE.test(line) || REFERENCE.test(line) || /^\s*\|/.test(line)
		|| (line.includes("|") && i + 1 < lines.length && tableDelimiter(lines[i + 1]))
		|| LIST.test(line) || QUOTE.test(line);
}

function proseLine(line: string): boolean {
	if (BLANK.test(line) || INDENTED.test(line) || RULE.test(line)) return false;
	const quote = line.match(QUOTE);
	if (quote) return proseLine(line.slice(quote[0].length));
	const marker = line.match(LIST);
	if (marker) return proseLine(marker[4]);
	return !blockStart([line], 0);
}

function indentation(line: string): number {
	let columns = 0;
	for (const char of line) {
		if (char === " ") columns++;
		else if (char === "\t") columns += 4 - columns % 4;
		else break;
	}
	return columns;
}

function stripIndent(line: string, columns: number): string {
	let consumed = 0;
	let i = 0;
	while (i < line.length && consumed < columns && /[ \t]/.test(line[i])) {
		consumed += line[i] === "\t" ? 4 - consumed % 4 : 1;
		i++;
	}
	return " ".repeat(Math.max(0, consumed - columns)) + line.slice(i);
}

function formatText(text: string, width: number): string {
	if (!text) return text;
	const lines = text.split("\n");
	const out: string[] = [];
	let i = 0;
	while (i < lines.length) {
		const line = lines[i];
		if (BLANK.test(line)) {
			out.push(line);
			i++;
			continue;
		}
		const fence = line.match(FENCE)?.[1];
		if (fence) {
			out.push(lines[i++]);
			while (i < lines.length) {
				const code = lines[i++];
				out.push(code);
				if (closesFence(code, fence)) break;
			}
			continue;
		}
		if (INDENTED.test(line)) {
			do { out.push(lines[i++]); }
			while (i < lines.length && (INDENTED.test(lines[i]) || BLANK.test(lines[i])));
			continue;
		}
		if (HEADING.test(line) || SETEXT.test(line) || RULE.test(line)) {
			out.push(lines[i++]);
			continue;
		}
		if (REFERENCE.test(line)) {
			out.push(lines[i++]);
			while (i < lines.length && /^[ \t]+\S/.test(lines[i])) out.push(lines[i++]);
			continue;
		}
		if (line.includes("|") && i + 1 < lines.length && tableDelimiter(lines[i + 1])) {
			out.push(lines[i++], lines[i++]);
			while (i < lines.length && !BLANK.test(lines[i]) && lines[i].includes("|")) out.push(lines[i++]);
			continue;
		}
		if (/^\s*\|/.test(line)) {
			out.push(lines[i++]);
			continue;
		}
		const quote = line.match(QUOTE);
		if (quote) {
			const body: string[] = [];
			let bodyFence: string | undefined;
			let lazy = false;
			while (i < lines.length) {
				const prefix = lines[i].match(QUOTE);
				if (!prefix && (!lazy || BLANK.test(lines[i]) || blockStart(lines, i))) break;
				const content = prefix ? lines[i].slice(prefix[0].length) : lines[i];
				body.push(content);
				i++;
				if (bodyFence) {
					if (closesFence(content, bodyFence)) bodyFence = undefined;
					lazy = false;
				} else {
					bodyFence = content.match(FENCE)?.[1];
					lazy = proseLine(content);
				}
			}
			const innerWidth = Math.max(1, width - 2);
			out.push(...formatText(body.join("\n"), innerWidth).split("\n").map(content => `> ${content}`));
			continue;
		}
		const marker = line.match(LIST);
		if (marker) {
			let prefix = "";
			for (const char of marker[1] + marker[2] + marker[3]) {
				prefix += char === "\t" ? " ".repeat(4 - prefix.length % 4) : char;
			}
			const body = [marker[4]];
			let bodyFence = marker[4].match(FENCE)?.[1];
			let lazy = proseLine(marker[4]);
			let afterBlank = false;
			i++;
			while (i < lines.length) {
				const continuation = lines[i];
				if (BLANK.test(continuation)) {
					body.push(stripIndent(continuation, prefix.length));
					afterBlank = true;
					lazy = false;
					i++;
					continue;
				}
				const columns = indentation(continuation);
				if (columns < prefix.length
					&& (afterBlank || !lazy || blockStart(lines, i))) break;
				const content = columns >= prefix.length ? stripIndent(continuation, prefix.length) : continuation;
				body.push(content);
				i++;
				afterBlank = false;
				if (bodyFence) {
					if (closesFence(content, bodyFence)) bodyFence = undefined;
					lazy = false;
				} else {
					bodyFence = content.match(FENCE)?.[1];
					lazy = proseLine(content);
				}
			}
			const innerWidth = Math.max(1, width - prefix.length);
			const formatted = formatText(body.join("\n"), innerWidth).split("\n");
			out.push(prefix + formatted[0]);
			out.push(...formatted.slice(1).map(content => BLANK.test(content) ? content : " ".repeat(prefix.length) + content));
			continue;
		}
		let segment: string[] = [];
		const flush = () => {
			if (!segment.length) return;
			const paragraph = segment.map(fragment => {
				const slashes = fragment.match(/\\+$/)?.[0].length ?? 0;
				return / {2,}$/.test(fragment) || slashes % 2 === 1 ? fragment.trimStart() : fragment.trim();
			}).join(" ");
			out.push(...wrapLine(paragraph, width));
			segment = [];
		};
		while (i < lines.length && !BLANK.test(lines[i])) {
			if (segment.length && SETEXT.test(lines[i])) {
				out.push(...segment, lines[i++]);
				segment = [];
				break;
			}
			if (blockStart(lines, i)) break;
			const fragment = lines[i++];
			segment.push(fragment);
			const slashes = fragment.match(/\\+$/)?.[0].length ?? 0;
			if (/ {2,}$/.test(fragment) || slashes % 2 === 1) flush();
		}
		flush();
	}
	return out.join("\n");
}

export function wrapText(text: string): string {
	return formatText(text, WIDTH);
}

function fmt(ms: number): string {
	const s = Math.round(ms / 1000);
	if (s < 60) return `${s} s`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m} min ${s % 60} s`;
	return `${Math.floor(m / 60)} h ${m % 60} min ${s % 60} s`;
}

export default function wrapAndTimer(pi: ExtensionAPI) {
	let startedAt: number | undefined;

	pi.on("assistant_message", event => ({
		content: event.message.content.map(block =>
			block.type === "text" ? { ...block, text: wrapText(block.text) } : block,
		),
	}));

	pi.on("before_agent_start", () => {
		startedAt ??= Date.now();
	});

	pi.on("agent_end", async (_event, ctx) => {
		if (startedAt === undefined) return;
		const elapsed = Date.now() - startedAt;
		startedAt = undefined;
		ctx.ui.notify(`Vremya raboty: ${fmt(elapsed)}`, "info");
	});
}
