import { AssistantMessageComponent, ReadToolGroupComponent, ToolExecutionComponent, UserMessageComponent } from "@oh-my-pi/pi-coding-agent";
import { theme, truncateToWidth } from "@oh-my-pi/pi-tui";
import { assistantMessages, enabled, expandedNow, parents, recordExpanded } from "./state";

type Render = (width: number) => readonly string[];

interface Container {
	readonly children: readonly object[];
}

/** One turn: the final answer and the blocks folded between the user message and it. */
interface Turn {
	readonly final: object;
	/** The first assistant block of the turn, the start of a replayed duration. */
	readonly first?: object;
	/** Blocks strictly between the user message and the final answer. */
	readonly middle: readonly object[];
	readonly closed: boolean;
}

type Role = { kind: "final" } | { kind: "middle"; index: number; turn: Turn };

interface Model {
	readonly roles: WeakMap<object, Role>;
	readonly turns: readonly Turn[];
}

interface Cached {
	epoch: number;
	running: boolean;
	count: number;
	model: Model;
}

interface Thinking {
	/** The message has a thinking block. */
	has: boolean;
	/** The thinking has ended: a visible answer followed it, or the message is final. */
	ended: boolean;
	start?: number;
	end?: number;
}

const INSTALLED = Symbol.for("my-omp-harness.cursor-feed.turn");
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
const EMPTY: readonly string[] = [];

/** The view of each transcript child before the fold wrap. */
const originals = new WeakMap<object, Render>();
const thinking = new WeakMap<object, Thinking>();
const models = new WeakMap<object, Cached>();
/** Components whose original render is running (their stable-row publication happens inside it). */
const rendering = new WeakSet<object>();

/** Bumped on every change that can alter a turn model. */
let epoch = 0;
let running = false;

function paint(text: string): string {
	try {
		return theme.fg("dim", text);
	} catch {
		return text;
	}
}

function blockType(block: unknown): string | undefined {
	if (typeof block !== "object" || block === null || !("type" in block)) return undefined;
	return typeof block.type === "string" ? block.type : undefined;
}

function textOf(block: unknown): string | undefined {
	if (typeof block !== "object" || block === null || !("text" in block)) return undefined;
	return typeof block.text === "string" ? block.text : undefined;
}

function contentOf(message: unknown): readonly unknown[] {
	if (typeof message !== "object" || message === null || !("content" in message)) return EMPTY;
	return Array.isArray(message.content) ? message.content : EMPTY;
}

function isThinkingBlock(block: unknown): boolean {
	const type = blockType(block);
	return type === "thinking" || type === "redactedThinking";
}

/** A block that ends the thinking before it: visible text or a tool call. */
function isAnswerBlock(block: unknown): boolean {
	const type = blockType(block);
	if (type === "toolCall") return true;
	return type === "text" && (textOf(block)?.trim() ?? "") !== "";
}

/** A final assistant message: it has a stop reason, is not a tool-use stop, and carries no tool call. */
function isFinalMessage(record: { content?: unknown; stopReason?: unknown } | undefined): boolean {
	if (!record || record.stopReason === undefined || record.stopReason === "toolUse") return false;
	return !contentOf(record).some(block => blockType(block) === "toolCall");
}

function isToolRow(child: object): boolean {
	return child instanceof ToolExecutionComponent || child instanceof ReadToolGroupComponent;
}

function formatSpan(ms: number): string {
	const total = Math.max(0, Math.round(ms / 1000));
	if (total < 60) return `${total}s`;
	return `${Math.floor(total / 60)}m ${String(total % 60).padStart(2, "0")}s`;
}

function stopReasonOf(message: unknown): unknown {
	if (typeof message !== "object" || message === null || !("stopReason" in message)) return undefined;
	return message.stopReason;
}

/**
 * Thinking timing: the first live update that holds a thinking block starts it; a visible
 * answer block ends it in a live update, and a final update (one with a stop reason) ends it too.
 */
function recordThinking(component: object, message: unknown, transient: boolean): void {
	const content = contentOf(message);
	const at = content.findIndex(isThinkingBlock);
	if (at < 0) return;
	const state = thinking.get(component) ?? { has: false, ended: false };
	thinking.set(component, state);
	state.has = true;
	const now = performance.now();
	if (transient) {
		state.start ??= now;
		if (!state.ended && content.slice(at + 1).some(isAnswerBlock)) {
			state.ended = true;
			state.end = now;
		}
	} else if (!state.ended && stopReasonOf(message) !== undefined) {
		// A replayed message has no start, so it ends without a duration.
		state.ended = true;
		if (state.start !== undefined) state.end = now;
	}
}

/** The Thought label; undefined while the thinking streams or when the message has none. */
function thoughtLabel(component: object): string | undefined {
	const state = thinking.get(component);
	if (!state?.has || !state.ended) return undefined;
	if (state.start === undefined || state.end === undefined) return "Thought";
	return `Thought for ${formatSpan(state.end - state.start)}`;
}

/**
 * The Thought row of a component, or undefined when it shows none. Both the render
 * and the stable-row render take their row from here, so they carry the same bytes.
 */
function thoughtRow(component: object, width: number): string | undefined {
	if (!enabled()) return undefined;
	const label = thoughtLabel(component);
	if (label === undefined || (roleOf(component)?.kind === "final" && !expandedNow())) return undefined;
	return truncateToWidth(paint(label), width);
}

/** Final answer of the turn (start, end): the last final assistant block with no tool row after it. */
function finalIndex(children: readonly object[], start: number, end: number): number {
	let toolAfter = false;
	for (let index = end - 1; index > start; index--) {
		const child = children[index]!;
		if (isToolRow(child)) toolAfter = true;
		else if (!toolAfter && child instanceof AssistantMessageComponent && isFinalMessage(assistantMessages.get(child))) {
			return index;
		}
	}
	return -1;
}

function buildModel(children: readonly object[]): Model {
	const roles = new WeakMap<object, Role>();
	const turns: Turn[] = [];
	let start = -1;
	for (let index = 0; index <= children.length; index++) {
		if (index < children.length && !(children[index] instanceof UserMessageComponent)) continue;
		if (start >= 0) {
			const final = finalIndex(children, start, index);
			if (final >= 0) {
				const middle = children.slice(start + 1, final);
				const first = children.slice(start + 1, final + 1).find(child => child instanceof AssistantMessageComponent);
				const turn: Turn = {
					final: children[final]!,
					first,
					middle,
					// A later user message ends the turn; otherwise only the end of the main run does.
					closed: index < children.length || !running,
				};
				turns.push(turn);
				if (turn.closed && middle.length > 0) {
					roles.set(turn.final, { kind: "final" });
					middle.forEach((child, position) => roles.set(child, { kind: "middle", index: position, turn }));
				}
			}
		}
		start = index;
	}
	return { roles, turns };
}

function modelOf(container: Container): Model {
	const cached = models.get(container);
	const count = container.children.length;
	if (cached && cached.epoch === epoch && cached.running === running && cached.count === count) return cached.model;
	const model = buildModel(container.children);
	models.set(container, { epoch, running, count, model });
	return model;
}

function roleOf(child: object): Role | undefined {
	if (!enabled()) return undefined;
	const container = parents.get(child);
	return container ? modelOf(container).roles.get(child) : undefined;
}

function stampOf(child: object): number | undefined {
	const timestamp = assistantMessages.get(child)?.timestamp;
	return typeof timestamp === "number" ? timestamp : undefined;
}

function durationOf(turn: Turn): number | undefined {
	const first = turn.first === undefined ? undefined : stampOf(turn.first);
	const last = stampOf(turn.final);
	return first !== undefined && last !== undefined && last >= first ? last - first : undefined;
}

function foldLine(turn: Turn, width: number): string {
	const span = durationOf(turn);
	const label = span === undefined ? "Worked" : `Worked for ${formatSpan(span)}`;
	return truncateToWidth(paint(`${label} ${expandedNow() ? "˅" : "›"}`), width);
}

function isBlank(row: string): boolean {
	return row.replace(ANSI, "").trim() === "";
}

function trimBlank(rows: readonly string[]): readonly string[] {
	let start = 0;
	let end = rows.length;
	while (start < end && isBlank(rows[start]!)) start++;
	while (end > start && isBlank(rows[end - 1]!)) end--;
	return rows.slice(start, end);
}

/** The expanded body: the original views of every folded block, in order, without the blank edges between them. */
function bodyOf(turn: Turn, width: number): string[] {
	const out: string[] = [];
	for (const child of turn.middle) {
		const original = originals.get(child);
		if (!original) continue;
		for (const row of trimBlank(original.call(child, width))) out.push(row);
	}
	return out;
}

/** Rows of a transcript child inside a folded turn, or undefined for the original view. */
function foldRows(child: object, width: number): readonly string[] | undefined {
	const role = roleOf(child);
	if (!role || role.kind !== "middle") return undefined;
	if (role.index > 0) return EMPTY;
	const head = foldLine(role.turn, width);
	return expandedNow() ? [head, ...bodyOf(role.turn, width)] : [head];
}

/** Wraps a transcript child's own render once so that a folded turn renders as its fold row. */
export function wrapChild(child: object): void {
	epoch++;
	if (originals.has(child)) return;
	const target = child as { render?: unknown };
	if (typeof target.render !== "function") return;
	const original = target.render as unknown as Render;
	originals.set(child, original);
	target.render = (width: number): readonly string[] => {
		try {
			const folded = foldRows(child, width);
			if (folded !== undefined) return folded;
		} catch {
			// Fail safe: the original view stands.
		}
		return original.call(child, width);
	};
}

function patchAssistant(): void {
	const proto = AssistantMessageComponent.prototype;
	const record = proto as unknown as Record<symbol, unknown>;
	if (record[INSTALLED]) return;
	record[INSTALLED] = true;
	const updateContent = proto.updateContent;
	const render = proto.render;
	const renderStable = proto.renderTranscriptStableRows;
	const setExpanded = proto.setExpanded;

	proto.updateContent = function (
		this: AssistantMessageComponent,
		...args: Parameters<AssistantMessageComponent["updateContent"]>
	) {
		const out = updateContent.apply(this, args);
		try {
			recordThinking(this, args[0], args[1]?.transient === true);
		} catch {
			// Fail safe: the duration is simply not shown.
		}
		epoch++;
		return out;
	};

	proto.render = function (this: AssistantMessageComponent, width: number): readonly string[] {
		// While the original render runs, its stable-row publication must see the unprefixed rows it publishes.
		rendering.add(this);
		let rows: readonly string[];
		try {
			rows = render.call(this, width);
		} finally {
			rendering.delete(this);
		}
		try {
			const row = thoughtRow(this, width);
			return row === undefined ? rows : [row, ...rows];
		} catch {
			return rows;
		}
	};

	proto.renderTranscriptStableRows = function (this: AssistantMessageComponent, count: number, width: number): readonly string[] {
		const rows = renderStable.call(this, count, width);
		try {
			if (!(count > 0) || rendering.has(this)) return rows;
			const row = thoughtRow(this, width);
			return row === undefined ? rows : [row, ...rows];
		} catch {
			return rows;
		}
	};

	proto.setExpanded = function (this: AssistantMessageComponent, ...args: Parameters<AssistantMessageComponent["setExpanded"]>) {
		recordExpanded(this, args[0]);
		return setExpanded.apply(this, args);
	};
}

/** Installs the assistant-message patches once per process. */
export function installTurn(): void {
	patchAssistant();
}

/** The main agent run started. */
export function mainAgentStarted(): void {
	running = true;
	epoch++;
}

/** The main agent run ended. */
export function mainAgentEnded(): void {
	running = false;
	epoch++;
}
