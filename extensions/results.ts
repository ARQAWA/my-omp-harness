import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { lookup } from "@oh-my-pi/pi-coding-agent/config/registry";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ANSWER_MAX_CHARS = 80_000;
const OUTPUT_MAX_CHARS = 100_000;
const CHARS_PER_TOKEN = 4;
const BUDGET_TOKENS = 150_000;
const BUDGET_TOKEN_FLOOR = 50_000;

type Fields = Record<string, unknown>;

type ArtifactSource = {
	getArtifactsDir(): string;
	getSessionFile(): string | null | undefined;
};

type TurnBudget = { budgetChars: number; used: number };

// Per agent id, so that concurrent sessions keep their own turn budgets.
const budgets = new Map<string, TurnBudget>();
const answers = new Map<string, string>();

const PREVIEW = /<preview full-output="agent:\/\/([\w-]+)">([\s\S]*?)<\/preview>/g;
const FULL_OUTPUT = /^Full output: artifact:\/\/(\d+)$/gm;
const ELISION = /\[…[^\]\n]*elided…\]/;
const ARTIFACT_REF = /artifact:\/\/(\d+)/;
const FENCE_OPEN = "Command output:\n\n```\n";
const FENCE_CLOSE = "\n```";

function fields(value: unknown): Fields | undefined {
	return typeof value === "object" && value !== null ? (value as Fields) : undefined;
}

function artifactsDir(source: ArtifactSource): string | undefined {
	try {
		const dir = source.getArtifactsDir();
		if (dir) return dir;
	} catch {}
	try {
		const session = source.getSessionFile();
		return session ? session.replace(/\.jsonl$/, "") : undefined;
	} catch {
		return undefined;
	}
}

function isRegularFile(path: string): boolean {
	try {
		return statSync(path).isFile();
	} catch {
		return false;
	}
}

// The artifact named `<id>.<ext>` in the artifacts directory.
function artifactFile(dir: string, id: string): string | undefined {
	let names: string[];
	try {
		names = readdirSync(dir);
	} catch {
		return undefined;
	}
	const name = names.find(n => n.startsWith(`${id}.`));
	if (name === undefined) return undefined;
	const file = join(dir, name);
	return isRegularFile(file) ? file : undefined;
}

// Cuts text to limit characters and names the continuation line after the cut.
function cutText(text: string, limit: number, label: string, path: string): string {
	if (text.length <= limit) return text;
	const shown = text.slice(0, limit);
	const line = (shown.match(/\n/g)?.length ?? 0) + 1;
	return `${shown}\n[${label} cut at ${limit.toLocaleString("en-US")} characters. Read the rest with read path=${path} offset=${line}]`;
}

// A structured subagent answer is a JSON string literal or object; plain text is returned as it is.
function decodeAnswer(raw: string): string {
	try {
		const value: unknown = JSON.parse(raw);
		if (typeof value === "string") return value;
		if (typeof value === "object" && value !== null) return JSON.stringify(value, null, 2);
	} catch {}
	return raw;
}

function answerText(dir: string, id: string): string | undefined {
	const cached = answers.get(id);
	if (cached !== undefined) return cached;
	const file = join(dir, `${id}.md`);
	if (!isRegularFile(file)) return undefined;
	const text = decodeAnswer(readFileSync(file, "utf8"));
	answers.set(id, text);
	return text;
}

function rewriteAnswers(text: string, dir: string | undefined): string {
	if (dir === undefined) return text;
	return text
		.replace(PREVIEW, (whole: string, id: string, body: string) => {
			const full = answerText(dir, id);
			if (full === undefined || full.length <= body.length) return whole;
			return `<preview full-output="agent://${id}">${cutText(full, ANSWER_MAX_CHARS, "Answer", `agent://${id}`)}</preview>`;
		})
		.replace(FULL_OUTPUT, (whole: string, id: string) => {
			const file = artifactFile(dir, id);
			if (file === undefined) return whole;
			return `Full output:\n${cutText(readFileSync(file, "utf8"), ANSWER_MAX_CHARS, "Output", file)}`;
		});
}

// Applies rewrite to every text part of a message (or to its string content); returns the same object when nothing changed.
function withText<T>(message: T, rewrite: (text: string) => string): T {
	const record = fields(message);
	if (record === undefined) return message;
	const content = record.content;
	if (typeof content === "string") {
		const text = rewrite(content);
		return text === content ? message : ({ ...record, content: text } as T);
	}
	if (!Array.isArray(content)) return message;
	let changed = false;
	const parts = content.map((part: unknown) => {
		const p = fields(part);
		if (p?.type !== "text" || typeof p.text !== "string") return part;
		const text = rewrite(p.text);
		if (text === p.text) return part;
		changed = true;
		return { ...p, text };
	});
	return changed ? ({ ...record, content: parts } as T) : message;
}

// Bash/eval output that was cut and spilled to an artifact: its fence body (or the whole text) is replaced by the artifact text.
function expandElided(text: string, dir: string): string {
	if (!ELISION.test(text)) return text;
	const ref = text.match(ARTIFACT_REF);
	if (ref === null) return text;
	const file = artifactFile(dir, ref[1]!);
	if (file === undefined) return text;
	const full = readFileSync(file, "utf8");
	const open = text.indexOf(FENCE_OPEN);
	if (open >= 0) {
		const start = open + FENCE_OPEN.length;
		const end = text.lastIndexOf(FENCE_CLOSE);
		if (end >= start) return text.slice(0, start) + cutText(full, OUTPUT_MAX_CHARS, "Output", file) + text.slice(end);
	}
	return cutText(full, OUTPUT_MAX_CHARS, "Output", file);
}

function expandOutputs(content: readonly unknown[], dir: string | undefined): readonly unknown[] {
	if (dir === undefined) return content;
	let changed = false;
	const next = content.map(part => {
		const p = fields(part);
		if (p?.type !== "text" || typeof p.text !== "string") return part;
		const text = expandElided(p.text, dir);
		if (text === p.text) return part;
		changed = true;
		return { ...p, text };
	});
	return changed ? next : content;
}

function budgetTokens(tokens: number, contextWindow: number, configured: unknown): number {
	if (tokens < BUDGET_TOKEN_FLOOR) return BUDGET_TOKENS;
	const threshold =
		typeof configured === "number" && configured > 0
			? configured
			: contextWindow - Math.max(16_384, 0.15 * contextWindow);
	return Math.max(0, Math.floor((threshold - tokens) / 2));
}

// Keeps the first characters of a turn's text that fit its remaining budget; the full text goes to a file.
function budgetContent(
	content: readonly unknown[],
	state: TurnBudget,
	dir: string | undefined,
	toolCallId: string,
): readonly unknown[] | undefined {
	const texts: string[] = [];
	for (const part of content) {
		const p = fields(part);
		if (p?.type === "text" && typeof p.text === "string") texts.push(p.text);
	}
	const full = texts.join("\n");
	if (state.used + full.length <= state.budgetChars) {
		state.used += full.length;
		return undefined;
	}
	if (dir === undefined) {
		state.used += full.length;
		return undefined;
	}
	const shown = full.slice(0, Math.max(0, state.budgetChars - state.used));
	const file = join(dir, `budget-${toolCallId}.txt`);
	mkdirSync(dir, { recursive: true });
	writeFileSync(file, full);
	state.used += shown.length;
	const line = (shown.match(/\n/g)?.length ?? 0) + 1;
	const notice = `\n[Turn result budget reached: showing ${shown.length} of ${full.length} characters. Full result: ${file}; read it with read path=${file} offset=${line}]`;
	const out: unknown[] = [];
	let placed = false;
	for (const part of content) {
		const p = fields(part);
		if (p?.type !== "text" || typeof p.text !== "string") {
			out.push(part);
		} else if (!placed) {
			placed = true;
			out.push({ ...p, text: `${shown}${notice}` });
		}
	}
	return out;
}

export default function results(pi: ExtensionAPI) {
	pi.on("turn_start", (_event, ctx) => {
		const usage = ctx.getContextUsage();
		const tokens = usage?.tokens ?? 0;
		const contextWindow = usage?.contextWindow ?? 0;
		const configured: unknown = lookup("compaction.thresholdTokens")?.get(pi.pi.settings);
		budgets.set(ctx.agent.id, {
			budgetChars: CHARS_PER_TOKEN * budgetTokens(tokens, contextWindow, configured),
			used: 0,
		});
	});

	pi.on("context", (event, ctx) => {
		try {
			const dir = artifactsDir(ctx.sessionManager);
			let changed = false;
			const messages = event.messages.map(message => {
				const next = withText(message, text => rewriteAnswers(text, dir));
				if (next !== message) changed = true;
				return next;
			});
			return changed ? { messages } : undefined;
		} catch {
			return undefined;
		}
	});

	pi.on("tool_result", (event, ctx) => {
		try {
			const dir = artifactsDir(ctx.sessionManager);
			let content: readonly unknown[] = event.content;
			let changed = false;
			if (event.toolName === "bash" || event.toolName === "eval") {
				const next = expandOutputs(content, dir);
				if (next !== content) {
					content = next;
					changed = true;
				}
			}
			const state = budgets.get(ctx.agent.id);
			if (state !== undefined) {
				const next = budgetContent(content, state, dir, event.toolCallId);
				if (next !== undefined) {
					content = next;
					changed = true;
				}
			}
			return changed ? { content: content as typeof event.content } : undefined;
		} catch {
			return undefined;
		}
	});
}
