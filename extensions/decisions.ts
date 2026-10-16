// Records the owner's decisions of a session in a flat registry, shows them to Main and writes them to a Markdown file.
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { completeSimple, type ImageContent, type TextContent } from "@oh-my-pi/pi-ai";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";

const ENTRY_TYPE = "my-omp-harness.decisions";
const PROCESSING = Symbol.for("my-omp-harness.decisions-processing");
const FILTER_MODEL = "claude-haiku-5-5";
const RECORD_MODEL = "claude-sonnet-5-5";

const FILTER_PROMPT = `You are a fast filter in front of a decision recorder. A coding agent and its owner talk in a long session. The recorder keeps the list of the owner's durable decisions: what the result must be, how the agent must work, which option, value, tool, model, name, place or design was chosen, what is forbidden. You only answer whether the owner's NEW message may add, change or cancel such a decision, so the recorder must look at it.

Answer with one JSON object and no other text: {"decision": true} or {"decision": false}.

Answer true when the new message contains at least one concrete statement that fixes something for the result or for later work:
- a requirement on the result: what it must contain, where it goes, its format, length, language, place or value ("положи в папку X", "в две строки", "на английском");
- a rule for how the agent must work or answer from now on;
- a choice between options, including short answers to the agent's numbered options ("1a 2b", "3 +", "вариант b");
- a rejection, prohibition or cancellation ("не надо", "без", "нельзя", "отменяем", "вместо", "передумал");
- an approval ("да", "го", "одобряю") right after the agent proposed a concrete plan, design or option list in the conversation above;
- the owner's own idea of how something must work or in which order the work goes, even when phrased as a question, a guess or "я думаю" ("а мы не можем сделать X?", "я думаю, надо давать ему Y", "сначала протестируй, потом план").

Answer false when the message only:
- asks a question, asks for an explanation, a summary, a status or an opinion;
- asks to research, compare, test, measure or think, without fixing what the result must be;
- complains, reacts or thinks aloud without stating what must change;
- says "продолжай", or approves when the agent above only asked whether to start a step that holds no new choice;
- gives information about itself or the situation.

If one sentence of a long message fixes something, answer true. If you cannot decide, answer true.`;

const RECORD_PROMPT = `You keep the list of the owner's decisions in a long session between the owner and a coding agent. You see the current list, the conversation since the list last changed, and the owner's new message. Answer with one JSON object and no other text:
{"changes":[{"op":"add","text":"...","quote":"...","confirmed":"..."},{"op":"replace","id":"D3","text":"...","quote":"...","confirmed":"..."},{"op":"cancel","id":"D2","quote":"..."}]}
Most messages change nothing: answer {"changes":[]}. When in doubt, answer {"changes":[]}. An empty answer is always safe; a wrong item is harmful.

Step 1. Find candidates: sentences of the owner's NEW message that state a durable rule or choice the agent must keep following for the rest of the session (a requirement on the result, a rule for how the agent works or answers, a chosen tool, model, value or design, a rejection, a constraint).
Step 2. Drop a candidate if any of these is true:
- it is a question, complaint, emotion, thanks or status request;
- it is a one-off order or task step: "check X", "run", "fix this", "continue", "show me", "do it now", approving one diff, step, item or plan ("4+", "одобряю", "дифф принят");
- it only approves starting work ("go", "yes", "ok", "+", "да", "да давай", "давай попробуем", "го") — unless the agent's last text asked the owner to pick between named options or accept one named rule; then keep only that one picked option or rule;
- it is a detail the agent proposed that the owner did not state or pick himself;
- an item of the list already says it.
Step 3. Write each remaining candidate.
- text: one short sentence in the language of the owner's message that restates ONLY the owner's own words of the quote. Reuse his words. Keep every condition, "not", "only", "except", number and name he gave. Do not add anything from the agent's text, do not add reasons, do not generalize, do not merge separate rules. If you cannot restate it without adding meaning, use the quote itself as the text.
- quote: the owner's words from the new message for this decision, copied exactly, character for character.
- confirmed: only when the decision is a picked option from the agent's last text: those option words copied exactly. Leave it out otherwise.
- op: "add" for a new decision; "replace" with the id when the owner changes an existing item (text = the full rule as it holds now); "cancel" with the id when the owner drops an item without a replacement.`;

type Decision = { id: string; text: string; quote: string; confirmed?: string; replaces?: string; cancelled: boolean };
type Applied = { op: "add" | "replace" | "cancel"; id: string; text: string; confirmed?: string };
type ProcessingSlot = { active: boolean; pending?: string; refresh?: () => void };
type MessageLike = { role?: unknown; attribution?: unknown; customType?: unknown; content?: unknown; details?: unknown };
type Entry = { type?: unknown; customType?: unknown; data?: unknown; message?: MessageLike; attribution?: unknown; content?: unknown; details?: unknown };
type SessionView = ExtensionContext["sessionManager"];

let queue: Promise<void> = Promise.resolve();
const waiting: string[] = [];

/** The text of message content: a trimmed string, or the text parts joined with a line break. */
function textOf(content: unknown): string {
	if (typeof content === "string") return content.trim();
	if (!Array.isArray(content)) return "";
	const texts = content.flatMap(part => {
		const block = part as { type?: unknown; text?: unknown } | null;
		return block?.type === "text" && typeof block.text === "string" ? [block.text] : [];
	});
	return texts.join("\n").trim();
}

/** The text with every run of whitespace shrunk to one space. */
function normalize(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

/** The JSON object in an answer: the slice from its first "{" to its last "}". */
function parseAnswer(answer: string): Record<string, unknown> | undefined {
	const start = answer.indexOf("{");
	const end = answer.lastIndexOf("}");
	if (start < 0 || end < start) return undefined;
	try {
		const parsed: unknown = JSON.parse(answer.slice(start, end + 1));
		return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : undefined;
	} catch {
		return undefined;
	}
}

/** The owner's words in a message: a user message, a collab guest's prompt, or the prompt or arguments of a skill the owner called; anything else gives "". */
function ownerText(message: MessageLike): string {
	if (message.role === "user" && message.attribution !== "agent") return textOf(message.content);
	if (message.role === "custom" && message.customType === "collab-prompt" && message.attribution === "user") return textOf(message.content);
	if (message.role !== "custom" || message.customType !== "skill-prompt" || message.attribution !== "user") return "";
	const details = (message.details ?? {}) as { prompt?: unknown; args?: unknown };
	if (typeof details.prompt === "string" && details.prompt !== "") return details.prompt.trim();
	return typeof details.args === "string" ? details.args.trim() : "";
}

/** The entries of the session branch, oldest first. */
function branchEntries(sessionManager: SessionView): (Entry | null)[] {
	const raw: unknown = sessionManager.getBranch();
	return Array.isArray(raw) ? (raw as (Entry | null)[]) : [];
}

/** The registry of the last decisions entry on the branch, and the index after that entry (0 when there is none). */
function lastRegistry(entries: (Entry | null)[]): { registry: Decision[]; start: number } {
	for (let index = entries.length - 1; index >= 0; index--) {
		const entry = entries[index];
		if (entry?.type !== "custom" || entry.customType !== ENTRY_TYPE) continue;
		const data = (entry.data ?? {}) as { registry?: unknown };
		return { registry: Array.isArray(data.registry) ? (data.registry as Decision[]) : [], start: index + 1 };
	}
	return { registry: [], start: 0 };
}

/** The message that a branch entry carries, or undefined for an entry without one. */
function messageOf(entry: Entry | null): MessageLike | undefined {
	if (entry?.type === "message") return entry.message;
	if (entry?.type === "custom_message") {
		return { role: "custom", customType: entry.customType, attribution: entry.attribution, content: entry.content, details: entry.details };
	}
	return undefined;
}

/** The conversation after the given index as blocks of Agent and Owner text, and the agent's latest text. */
function conversationSince(entries: (Entry | null)[], start: number): { blocks: string[]; agentText: string } {
	const blocks: string[] = [];
	let turn = "";
	let agentText = "";
	for (const entry of entries.slice(start)) {
		const message = messageOf(entry);
		if (message === undefined) continue;
		const owner = ownerText(message);
		if (owner !== "") {
			blocks.push(`Agent: ${turn}\n\nOwner: ${owner}`);
			if (turn !== "") agentText = turn;
			turn = "";
			continue;
		}
		const text = message.role === "assistant" ? textOf(message.content) : "";
		if (text !== "") turn = turn === "" ? text : `${turn}\n\n${text}`;
	}
	if (turn !== "") blocks.push(`Agent: ${turn}`);
	return { blocks, agentText: turn !== "" ? turn : agentText };
}

/** The next decision id: the largest D-number in the registry plus one. */
function nextId(registry: Decision[]): string {
	let largest = 0;
	for (const decision of registry) {
		const match = /^D(\d+)$/.exec(decision.id);
		if (match) largest = Math.max(largest, Number(match[1]));
	}
	return `D${largest + 1}`;
}

/** Applies the recorder's changes to the registry in order and returns the applied ones; a change whose quote is not in the owner's message is skipped, and a confirmed text outside the agent's text is dropped. */
function applyChanges(registry: Decision[], returned: unknown[], owner: string, agentText: string): Applied[] {
	const applied: Applied[] = [];
	const ownerNormalized = normalize(owner);
	const agentNormalized = normalize(agentText);
	for (const change of returned) {
		const item = (change ?? {}) as { op?: unknown; id?: unknown; text?: unknown; quote?: unknown; confirmed?: unknown };
		const quote = typeof item.quote === "string" ? item.quote.trim() : "";
		if (quote === "" || !ownerNormalized.includes(normalize(quote))) continue;
		if (item.op === "cancel") {
			const target = registry.find(decision => decision.id === item.id);
			if (target === undefined) continue;
			target.cancelled = true;
			applied.push({ op: "cancel", id: target.id, text: target.text });
			continue;
		}
		if (item.op !== "add" && item.op !== "replace") continue;
		const text = typeof item.text === "string" ? item.text.trim() : "";
		if (text === "") continue;
		const confirmed = typeof item.confirmed === "string" ? item.confirmed.trim() : "";
		const kept = confirmed !== "" && agentNormalized.includes(normalize(confirmed)) ? confirmed : undefined;
		if (item.op === "add") {
			const id = nextId(registry);
			registry.push({ id, text, quote, confirmed: kept, cancelled: false });
			applied.push({ op: "add", id, text, confirmed: kept });
			continue;
		}
		const index = registry.findIndex(decision => decision.id === item.id && !decision.cancelled);
		if (index < 0) continue;
		const old = registry[index];
		const id = nextId(registry);
		registry.splice(index, 1);
		registry.push({ id, text, quote, confirmed: kept, replaces: old.text, cancelled: false });
		applied.push({ op: "replace", id, text, confirmed: kept });
	}
	return applied;
}

/** The decisions as list lines: one line each, with the quote and the approved proposal indented below it. */
function renderLines(registry: Decision[]): string[] {
	return registry.flatMap(decision => {
		const replaced = decision.replaces === undefined ? "" : ` (вместо: ${decision.replaces})`;
		const head = decision.cancelled ? `- ${decision.id}. ${decision.text} — отменено` : `- ${decision.id}. ${decision.text}${replaced}`;
		const lines = [head, `  > ${decision.quote}`];
		if (decision.confirmed !== undefined) lines.push(`  > Approved proposal: ${decision.confirmed}`);
		return lines;
	});
}

/** The Markdown file of the session's decisions: the session file with ".decisions.md" in place of ".jsonl"; undefined without such a session file. */
function markdownPath(ctx: ExtensionContext): string | undefined {
	const file = ctx.sessionManager.getSessionFile();
	if (!file || !file.endsWith(".jsonl")) return undefined;
	return file.replace(/\.jsonl$/, ".decisions.md");
}

/** Shows the owner's messages that wait for their check on the processing plate, or clears the plate when none wait. */
function showWaiting(): void {
	const slot = (globalThis as unknown as Record<symbol, ProcessingSlot | undefined>)[PROCESSING];
	if (slot === undefined) return;
	slot.active = waiting.length > 0;
	slot.pending = waiting.length > 0 ? waiting.join("\n\n") : undefined;
	slot.refresh?.();
}

/** Asks one Anthropic model with low reasoning and returns the text of its answer. */
async function ask(ctx: ExtensionContext, modelId: string, systemPrompt: string, input: string): Promise<string> {
	const model = ctx.modelRegistry.find("anthropic", modelId);
	if (!model) throw new Error(`model anthropic/${modelId} not found`);
	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
	if (!auth.ok) throw new Error(`no API key for anthropic/${modelId}`);
	const response = await completeSimple(
		model,
		{ systemPrompt, messages: [{ role: "user", content: [{ type: "text", text: input }], timestamp: Date.now() }] },
		{ apiKey: auth.apiKey, headers: auth.headers, reasoning: "low", maxTokens: 32000, cacheRetention: "none" },
	);
	return textOf(response.content);
}

/** Checks the owner's message against the decisions, then sends it on with the approved decisions added, or puts it back in the editor when the check fails. */
async function checkOwnerMessage(pi: ExtensionAPI, ctx: ExtensionContext, text: string, images: ImageContent[] | undefined): Promise<void> {
	try {
		const entries = branchEntries(ctx.sessionManager);
		const { registry, start } = lastRegistry(entries);
		const { blocks, agentText } = conversationSince(entries, start);
		const input = `<decisions>\n${JSON.stringify(registry)}\n</decisions>\n\n<conversation_since_last_change>\n${blocks.join("\n\n---\n\n")}\n</conversation_since_last_change>\n\n<owner_new_message>\n${text}\n</owner_new_message>`;
		const filter = parseAnswer(await ask(ctx, FILTER_MODEL, FILTER_PROMPT, input));
		let finalText = text;
		if (filter?.decision !== false) {
			const answer = parseAnswer(await ask(ctx, RECORD_MODEL, RECORD_PROMPT, input));
			const changes = answer?.changes;
			if (!Array.isArray(changes)) throw new Error("the recorder answer could not be parsed");
			const next = registry.map(decision => ({ ...decision }));
			const applied = applyChanges(next, changes, text, agentText);
			if (applied.length > 0) {
				pi.appendEntry(ENTRY_TYPE, { registry: next, applied });
				const markdown = markdownPath(ctx);
				if (markdown !== undefined) await writeFile(markdown, `# Decisions\n\n${renderLines(next).join("\n")}\n`);
				finalText = text + applied.filter(change => change.confirmed !== undefined).map(change => `\n\nApproved decision: ${change.text}`).join("");
			}
		}
		const index = waiting.indexOf(text);
		if (index >= 0) waiting.splice(index, 1);
		showWaiting();
		const content: string | (TextContent | ImageContent)[] = images !== undefined && images.length > 0 ? [{ type: "text", text: finalText }, ...images] : finalText;
		pi.sendUserMessage(content);
	} catch (error) {
		const index = waiting.indexOf(text);
		if (index >= 0) waiting.splice(index, 1);
		showWaiting();
		ctx.ui.notify(`Decisions check failed: ${error instanceof Error ? error.message : String(error)}. Your message was not sent.`, "error");
		ctx.ui.setEditorText(text);
	}
}

/** Registers the decision check on the owner's messages, the decisions note in Main's context and the decisions command. */
export default function decisions(pi: ExtensionAPI) {
	pi.on("input", (event, ctx) => {
		if (ctx.agent.kind !== "main" || ctx.mode !== "tui") return undefined;
		const trimmed = event.text.trim();
		if (event.source !== "interactive" || trimmed === "" || trimmed.startsWith("/")) return undefined;
		waiting.push(event.text);
		showWaiting();
		// Checks run one after another so each reads the registry the previous one wrote.
		queue = queue.then(() => checkOwnerMessage(pi, ctx, event.text, event.images)).catch(() => undefined);
		return { handled: true };
	});

	pi.on("context", (event, ctx) => {
		if (ctx.agent.kind !== "main") return undefined;
		const { registry } = lastRegistry(branchEntries(ctx.sessionManager));
		if (registry.length === 0) return undefined;
		const block = `<decisions>\nThe owner's decisions in this session. Keep following them. Only the owner changes them: to change one, propose the change and ask the owner.\n\n${renderLines(registry).join("\n")}\n</decisions>`;
		const note = {
			role: "user",
			content: [{ type: "text", text: block }],
			attribution: "agent",
			timestamp: Date.now(),
		} as unknown as (typeof event.messages)[number];
		return { messages: [...event.messages, note] };
	});

	pi.registerCommand("decisions", {
		description: "Open the owner's decisions of this session in Sublime Text",
		handler: async (_args, ctx) => {
			const file = markdownPath(ctx);
			if (file === undefined || !existsSync(file)) {
				ctx.ui.notify("No decisions are recorded in this session yet.", "info");
				return;
			}
			const child = spawn("subl", [file], { detached: true, stdio: "ignore" });
			child.on("error", error => ctx.ui.notify(`Could not open Sublime Text: ${error.message}`, "error"));
			child.unref();
		},
	});
}
