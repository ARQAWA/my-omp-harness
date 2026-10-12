import { AssistantMessageComponent, ReadToolGroupComponent, ToolExecutionComponent, UserMessageComponent } from "@oh-my-pi/pi-coding-agent";
import { theme } from "@oh-my-pi/pi-tui";
import { userGoalCard } from "./cards";
import { fitLine } from "./fit";
import { assistantMessages, enabled, expandedNow, parents, pinnedRows, recordExpanded, toolNameOf } from "./state";

type Render = (width: number) => readonly string[];

interface Container {
	readonly children: readonly object[];
}

/** A run of folded blocks between pinned rows: one fold row and one expanded body. */
interface Segment {
	/** The folded blocks, in transcript order. */
	readonly children: readonly object[];
	/** The assistant block that ends the segment's duration: the first one after it, up to the final answer. */
	readonly next?: object;
}

/** One turn: the final answer and the segments folded between the user message and it. */
interface Turn {
	readonly final: object;
	readonly segments: readonly Segment[];
	readonly closed: boolean;
}

type Role = { kind: "final" } | { kind: "middle"; index: number; segment: Segment };

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

const INSTALLED = Symbol.for("my-omp-harness.cursor-feed.turn");
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
const EMPTY: readonly string[] = [];

/** The view of each transcript child before the fold wrap. */
const originals = new WeakMap<object, Render>();
const models = new WeakMap<object, Cached>();

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

const REASONING_BLOCKS: ReadonlySet<string> = new Set(["thinking", "redactedThinking"]);

/** The message as the transcript draws it: reasoning blocks removed, everything else kept. The session's own message is not changed. */
function viewOf<T extends object>(message: T): T {
	const content = contentOf(message);
	const isReasoning = (block: unknown): boolean => REASONING_BLOCKS.has(blockType(block) ?? "");
	if (!content.some(isReasoning)) return message;
	return { ...message, content: content.filter(block => !isReasoning(block)) } as T;
}

/** A final assistant message: it has a stop reason, is not a tool-use stop, and carries no tool call. */
function isFinalMessage(record: { content?: unknown; stopReason?: unknown } | undefined): boolean {
	if (!record || record.stopReason === undefined || record.stopReason === "toolUse") return false;
	return !contentOf(record).some(block => blockType(block) === "toolCall");
}

function isToolRow(child: object): boolean {
	return child instanceof ToolExecutionComponent || child instanceof ReadToolGroupComponent;
}

/** Tool names whose rows stay visible outside the fold. */
const PINNED_TOOLS: Record<string, true> = { ask: true, goal: true };

/** The next tool row after a child, skipping other kinds of children. */
function nextToolRow(children: readonly object[], index: number): object | undefined {
	for (let i = index + 1; i < children.length; i++) {
		if (isToolRow(children[i]!)) return children[i];
	}
	return undefined;
}

/** Visible text whose next tool row is an ask block: it stays visible above the ask row. */
function isTextBeforeAsk(child: object, children: readonly object[], index: number): boolean {
	if (!(child instanceof AssistantMessageComponent)) return false;
	const hasText = contentOf(assistantMessages.get(child)).some(
		block => blockType(block) === "text" && (textOf(block)?.trim() ?? "") !== "",
	);
	if (!hasText) return false;
	const next = nextToolRow(children, index);
	return next instanceof ToolExecutionComponent && toolNameOf(next) === "ask";
}

/** A row that stays visible: cursor-feed's own rows, the ask and goal tool blocks, and the text right before an ask. */
function isPinned(child: object, children: readonly object[], index: number): boolean {
	return (
		pinnedRows.has(child) ||
		(child instanceof ToolExecutionComponent && PINNED_TOOLS[toolNameOf(child) ?? ""] === true) ||
		isTextBeforeAsk(child, children, index)
	);
}

function formatSpan(ms: number): string {
	const total = Math.max(0, Math.round(ms / 1000));
	if (total < 60) return `${total}s`;
	return `${Math.floor(total / 60)}m ${String(total % 60).padStart(2, "0")}s`;
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

/** The folded segments between a user message (start) and the final answer: runs of non-pinned children, split by pinned rows. */
function segmentsOf(children: readonly object[], start: number, final: number): Segment[] {
	const groups: Array<{ children: object[]; last: number }> = [];
	let open = false;
	for (let index = start + 1; index < final; index++) {
		const child = children[index]!;
		if (isPinned(child, children, index)) {
			open = false;
			continue;
		}
		if (!open) {
			groups.push({ children: [], last: index });
			open = true;
		}
		const group = groups[groups.length - 1]!;
		group.children.push(child);
		group.last = index;
	}
	return groups.map(group => ({
		children: group.children,
		next: children.slice(group.last + 1, final + 1).find(child => child instanceof AssistantMessageComponent),
	}));
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
				const segments = segmentsOf(children, start, final);
				const turn: Turn = {
					final: children[final]!,
					segments,
					// A later user message ends the turn; otherwise only the end of the main run does.
					closed: index < children.length || !running,
				};
				turns.push(turn);
				if (turn.closed && segments.length > 0) {
					roles.set(turn.final, { kind: "final" });
					for (const segment of segments) {
						segment.children.forEach((child, position) => roles.set(child, { kind: "middle", index: position, segment }));
					}
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

function durationOf(segment: Segment): number | undefined {
	const first = segment.children.find(child => child instanceof AssistantMessageComponent);
	const begin = first === undefined ? undefined : stampOf(first);
	const end = segment.next === undefined ? undefined : stampOf(segment.next);
	return begin !== undefined && end !== undefined && end >= begin ? end - begin : undefined;
}

function foldLine(segment: Segment, width: number): string {
	const span = durationOf(segment);
	const label = span === undefined ? "Worked" : `Worked for ${formatSpan(span)}`;
	return fitLine(paint(`${label} ${expandedNow() ? "˅" : "›"}`), width);
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
function bodyOf(segment: Segment, width: number): string[] {
	const out: string[] = [];
	for (const child of segment.children) {
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
	const head = foldLine(role.segment, width);
	return expandedNow() ? [head, ...bodyOf(role.segment, width)] : [head];
}

/** Text of each user message, read once from its describe tree; null when it has none. */
const userTexts = new WeakMap<object, string | null>();

/** The first markdown text in a describe tree (nodes are { k, p, c }), depth first. */
function markdownTextOf(node: unknown): string | undefined {
	if (typeof node !== "object" || node === null) return undefined;
	const kind = "k" in node ? node.k : undefined;
	const props = "p" in node ? node.p : undefined;
	const children = "c" in node ? node.c : undefined;
	const text = typeof props === "object" && props !== null && "text" in props ? props.text : undefined;
	if (kind === "md" && typeof text === "string") return text;
	if (!Array.isArray(children)) return undefined;
	for (const item of children) {
		const found = markdownTextOf(item);
		if (found !== undefined) return found;
	}
	return undefined;
}

/** The text of a user message, computed once per message. */
function userTextOf(child: object): string | undefined {
	const cached = userTexts.get(child);
	if (cached !== undefined) return cached ?? undefined;
	let text: string | null;
	try {
		const describeChild = "describe" in child ? child.describe : undefined;
		text = markdownTextOf(typeof describeChild === "function" ? describeChild.call(child) : undefined) ?? null;
	} catch {
		// Fail safe: the message keeps its original view.
		text = null;
	}
	userTexts.set(child, text);
	return text ?? undefined;
}

/** The goal card of a user message, or undefined for the original view. */
function goalCardRows(child: object, width: number): readonly string[] | undefined {
	if (!enabled() || !(child instanceof UserMessageComponent)) return undefined;
	const text = userTextOf(child);
	return text === undefined ? undefined : userGoalCard(text, width, expandedNow());
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
			const card = goalCardRows(child, width);
			if (card !== undefined) return card;
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
	const setHideThinkingBlock = proto.setHideThinkingBlock;
	/** Components whose underlying view hides reasoning. */
	const hidden = new WeakSet<object>();

	/** Rebuilds a component from its stored message with the reasoning blocks removed; a message without reasoning stays. */
	const rebuildView = (component: AssistantMessageComponent): void => {
		const stored = assistantMessages.get(component);
		if (!stored) return;
		const view = viewOf(stored);
		if (view !== stored) updateContent.call(component, view as Parameters<AssistantMessageComponent["updateContent"]>[0]);
	};

	/** Forces the underlying view to hide reasoning. The first hide drops the stable rows that may still hold reasoning; a component built before the harness was on is rebuilt first when rebuild is set. */
	const hideReasoning = (component: AssistantMessageComponent, rebuild: boolean): void => {
		const first = !hidden.has(component);
		setHideThinkingBlock.call(component, true);
		hidden.add(component);
		if (first && rebuild) rebuildView(component);
		if (first) component.resetTranscriptStableRows();
	};

	/** Hides reasoning on a component that has not been hidden yet, while cursor-feed is enabled. */
	const ensureHidden = (component: AssistantMessageComponent): void => {
		if (!enabled() || hidden.has(component)) return;
		try {
			hideReasoning(component, true);
		} catch {
			// Fail safe: the original view stands.
		}
	};

	proto.setHideThinkingBlock = function (this: AssistantMessageComponent, _hide: boolean): void {
		if (!enabled()) {
			hidden.delete(this);
			setHideThinkingBlock.call(this, _hide);
			return;
		}
		try {
			hideReasoning(this, true);
		} catch {
			// Fail safe: the original view stands.
		}
	};

	proto.updateContent = function (
		this: AssistantMessageComponent,
		...args: Parameters<AssistantMessageComponent["updateContent"]>
	) {
		try {
			if (enabled()) hideReasoning(this, false);
		} catch {
			// Fail safe: the host's hide value stands.
		}
		if (enabled()) args[0] = viewOf(args[0]);
		const out = updateContent.apply(this, args);
		epoch++;
		return out;
	};

	proto.render = function (this: AssistantMessageComponent, width: number): readonly string[] {
		ensureHidden(this);
		return render.call(this, width);
	};

	proto.renderTranscriptStableRows = function (this: AssistantMessageComponent, count: number, width: number): readonly string[] {
		ensureHidden(this);
		return renderStable.call(this, count, width);
	};

	proto.setExpanded = function (this: AssistantMessageComponent, ...args: Parameters<AssistantMessageComponent["setExpanded"]>) {
		recordExpanded(this, args[0]);
		const out = setExpanded.apply(this, args);
		try {
			if (enabled()) hideReasoning(this, true);
		} catch {
			// Fail safe: the original view stands.
		}
		return out;
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
