import { AssistantMessageComponent, ReadToolGroupComponent, ToolExecutionComponent } from "@oh-my-pi/pi-coding-agent";
import { type Component, Container, MetricRow, Spacer, theme, type ThemeColor, truncateToWidth } from "@oh-my-pi/pi-tui";
import { TranscriptContainer } from "@oh-my-pi/pi-tui/chrome";
import { toolRenderers } from "@oh-my-pi/pi-tui/tools";
import {
	allocations,
	assistantMessages,
	blockKinds,
	type CallResult,
	enabled,
	isExpanded,
	parents,
	painters,
	readGroups,
	type ReadAction,
	recordExpanded,
	type Timing,
	timings,
	toolActivityVisible,
} from "./state";
import {
	bodyOf,
	countsText,
	EXPLORE_TOOLS,
	formatElapsed,
	type Line,
	type Row,
	readRow,
	rowOf,
	type Status,
	statusOf,
} from "./rows";
import { wrapChild } from "./turn";

/** One render-time view of a tool block: the call or one of its results. */
interface Unit {
	toolName: string;
	args: unknown;
	result: unknown;
	options: unknown;
}

interface Call {
	toolName: string;
	args: unknown;
	results: CallResult[];
	isPartial: boolean;
}

interface Action {
	row: Row;
	status: Status;
	durationMs?: number;
}

/** A tool block or a read group that takes part in an Explored run. */
interface Member {
	component: object;
	actions: Action[];
}

type Loose = (...values: unknown[]) => Component | undefined;
interface Originals {
	renderCall: Loose;
	renderResult: Loose;
}

interface CursorFeedRenderers {
	renderCall(args: unknown, options: unknown, theme: unknown): Component;
	renderResult(result: unknown, options: unknown, theme: unknown, args?: unknown): Component;
}

const ORIGINAL = Symbol.for("my-omp-harness.cursor-feed.original");
const INSTALLED = Symbol.for("my-omp-harness.cursor-feed.installed");
/** Renderers that keep their own views. */
const SKIPPED: Record<string, true> = { task: true };
const TONE: Record<Line["tone"], ThemeColor> = {
	dim: "dim",
	text: "text",
	added: "toolDiffAdded",
	removed: "toolDiffRemoved",
};
const DOT: Record<Status, ThemeColor> = { running: "warning", error: "error", done: "success" };

/** Set while a tool block renders its children to collect the marker data. */
let collecting: Unit[] | undefined;

function paint(color: ThemeColor, text: string): string {
	try {
		return theme.fg(color, text);
	} catch {
		return text;
	}
}

function claim(proto: object, name: string): boolean {
	const key = Symbol.for(`my-omp-harness.cursor-feed.${name}`);
	const record: Record<symbol, unknown> = proto as Record<symbol, unknown>;
	if (record[key]) return false;
	record[key] = true;
	return true;
}

function isOriginals(value: unknown): value is Originals {
	return typeof value === "object" && value !== null && "renderCall" in value && "renderResult" in value;
}

/** Stands in for a tool renderer's view: absorbs its data while a block collects it. */
class ToolMarker implements Component {
	readonly #unit: Unit;
	readonly #fallback: () => Component | undefined;
	#view: Component | undefined;

	constructor(unit: Unit, fallback: () => Component | undefined) {
		this.#unit = unit;
		this.#fallback = fallback;
	}

	render(width: number): readonly string[] {
		if (collecting) {
			collecting.push(this.#unit);
			return [];
		}
		this.#view ??= this.#fallback();
		return this.#view?.render(width) ?? [];
	}

	invalidate(): void {
		this.#view?.invalidate?.();
	}
}

/** The original renderer of a tool, used when no block collects the marker. */
function fallback(toolName: string, method: keyof Originals, values: unknown[]): Component | undefined {
	const host = toolRenderers[toolName];
	if (!host) return undefined;
	const stash: Record<symbol, unknown> = host as unknown as Record<symbol, unknown>;
	const saved = stash[ORIGINAL];
	const original = isOriginals(saved) ? saved[method] : (host[method] as unknown as Loose);
	return original.apply(host, values);
}

function cursorFeedRender(toolName: string): CursorFeedRenderers {
	return {
		renderCall: (args, options, callTheme) =>
			new ToolMarker({ toolName, args, result: undefined, options }, () =>
				fallback(toolName, "renderCall", [args, options, callTheme]),
			),
		renderResult: (result, options, resultTheme, args) =>
			new ToolMarker({ toolName, args, result, options }, () =>
				fallback(toolName, "renderResult", [result, options, resultTheme, args]),
			),
	};
}

/** A marker view for a tool call: the owning block collects its data; the fallback is the original view. */
export function markerOf(
	toolName: string,
	args: unknown,
	options: unknown,
	fallback: () => Component | undefined,
): Component {
	return new ToolMarker({ toolName, args, result: undefined, options }, fallback);
}

function installRenderers(): void {
	for (const [name, host] of Object.entries(toolRenderers)) {
		const record: Record<symbol, unknown> = host as unknown as Record<symbol, unknown>;
		if (SKIPPED[name] || record[INSTALLED]) continue;
		record[INSTALLED] = true;
		// The originals are called with the arguments the registry passes them.
		const originals: Originals = {
			renderCall: host.renderCall as unknown as Loose,
			renderResult: host.renderResult as unknown as Loose,
		};
		record[ORIGINAL] = originals;
		const marker = cursorFeedRender(name);
		host.renderCall = marker.renderCall;
		host.renderResult = marker.renderResult;
		host.mergeCallAndResult = false;
		host.animatedPendingPreview = true;
		host.animatedPartialResult = true;
	}
}

/** Renders the children of a block with the collector set and returns the unit data. */
function collect(owner: object, width: number): Unit[] {
	const previous = collecting;
	const units: Unit[] = [];
	collecting = units;
	try {
		Container.prototype.render.call(owner, width);
	} finally {
		collecting = previous;
	}
	return units;
}

function timingOf(owner: object): Timing {
	let timing = timings.get(owner);
	if (!timing) {
		timing = {};
		timings.set(owner, timing);
	}
	return timing;
}

function durationOf(timing: Timing | undefined): number | undefined {
	if (timing?.startedAt === undefined) return undefined;
	return (timing.endedAt ?? performance.now()) - timing.startedAt;
}

function isCallResult(value: unknown): value is CallResult {
	return typeof value === "object" && value !== null && "content" in value && Array.isArray(value.content);
}

function callOf(units: Unit[]): Call {
	const results = units.flatMap(unit => (isCallResult(unit.result) ? [unit.result] : []));
	const isPartial = units.some(
		unit =>
			typeof unit.options === "object" && unit.options !== null && "isPartial" in unit.options && unit.options.isPartial === true,
	);
	return {
		toolName: units[0]!.toolName,
		args: units.find(unit => unit.args !== undefined)?.args,
		results,
		isPartial,
	};
}

function actionOf(call: Call, owner: object): Action {
	const durationMs = durationOf(timings.get(owner));
	return {
		row: rowOf(call.toolName, call.args, call.results),
		status: statusOf(call.results, call.isPartial),
		durationMs,
	};
}

function groupActions(map: Map<string, ReadAction>): Action[] {
	const actions: Action[] = [];
	for (const entry of map.values()) {
		actions.push({
			row: readRow(entry.args),
			status: statusOf(entry.result ? [entry.result] : [], entry.isPartial),
			durationMs: durationOf(entry),
		});
	}
	return actions;
}

function isTextBlock(block: unknown): block is { type: "text"; text: string } {
	return (
		typeof block === "object" &&
		block !== null &&
		"type" in block &&
		block.type === "text" &&
		"text" in block &&
		typeof block.text === "string"
	);
}

function hasVisibleText(message: { content?: unknown } | undefined): boolean {
	if (!message || !Array.isArray(message.content)) return false;
	return message.content.some(block => isTextBlock(block) && block.text.trim() !== "");
}

/** Classifies a transcript sibling: a member, skipped (transparent), or a run boundary. */
function classify(sibling: object, width: number): Member | "skip" | "stop" {
	if (sibling instanceof ReadToolGroupComponent) {
		const map = readGroups.get(sibling);
		if (!map || map.size === 0) return "skip";
		return { component: sibling, actions: groupActions(map) };
	}
	if (sibling instanceof ToolExecutionComponent) {
		const units = collect(sibling, width);
		if (units.length === 0) return "stop";
		const call = callOf(units);
		if (EXPLORE_TOOLS[call.toolName] !== true) return "stop";
		return { component: sibling, actions: [actionOf(call, sibling)] };
	}
	if (sibling instanceof AssistantMessageComponent) {
		return hasVisibleText(assistantMessages.get(sibling)) ? "stop" : "skip";
	}
	// A per-turn usage block: a Container of one Spacer and one MetricRow.
	const usageRow =
		sibling instanceof Container &&
		sibling.children.length === 2 &&
		sibling.children[0] instanceof Spacer &&
		sibling.children[1] instanceof MetricRow;
	return usageRow ? "skip" : "stop";
}

/** The Explored run around a member, in transcript order. */
function exploreRun(owner: object, width: number, self: Member): Member[] {
	const siblings = parents.get(owner)?.children;
	const index = siblings ? siblings.indexOf(owner) : -1;
	if (!siblings || index < 0) return [self];
	const before: Member[] = [];
	for (let i = index - 1; i >= 0; i--) {
		const found = classify(siblings[i]!, width);
		if (found === "stop") break;
		if (found !== "skip") before.unshift(found);
	}
	const after: Member[] = [];
	for (let i = index + 1; i < siblings.length; i++) {
		const found = classify(siblings[i]!, width);
		if (found === "stop") break;
		if (found !== "skip") after.push(found);
	}
	return [...before, self, ...after];
}

function rowLine(action: Action, withElapsed: boolean): string {
	const { row } = action;
	const stats = [
		row.added === undefined ? "" : paint(TONE.added, `+${row.added}`),
		row.removed === undefined ? "" : paint(TONE.removed, `−${row.removed}`),
	]
		.filter(Boolean)
		.join(" ");
	const head = [paint(DOT[action.status], "●"), row.verb, row.detail ? paint("dim", row.detail) : "", stats]
		.filter(Boolean)
		.join(" ");
	const time =
		withElapsed && action.durationMs !== undefined ? ` ${paint("dim", `· ${formatElapsed(action.durationMs)}`)}` : "";
	return head + time;
}

function standaloneLines(owner: object, call: Call, width: number): string[] {
	const out = [rowLine(actionOf(call, owner), true)];
	if (isExpanded(owner)) {
		const body = bodyOf(call.toolName, call.args, call.results);
		out.push(...body.map(line => `  ${paint(TONE[line.tone], line.text)}`));
	}
	return out.map(text => truncateToWidth(text, width));
}

function groupLines(owner: object, run: Member[], width: number): string[] {
	const actions = run.flatMap(member => member.actions);
	const files = actions.reduce((total, action) => total + action.row.files, 0);
	const searches = actions.reduce((total, action) => total + action.row.searches, 0);
	const running = actions.some(action => action.status === "running");
	const failed = actions.some(action => action.status === "error");
	const groupStatus: Status = running ? "running" : failed ? "error" : "done";
	const timed = actions.flatMap(action => (action.durationMs === undefined ? [] : [action.durationMs]));
	const total = timed.reduce((sum, ms) => sum + ms, 0);
	const elapsed = timed.length > 0 ? ` ${paint("dim", `· ${formatElapsed(total)}`)}` : "";
	const verb = running ? "Exploring" : "Explored";
	const out = [`${paint(DOT[groupStatus], "●")} ${verb} ${paint("dim", countsText(files, searches))}${elapsed}`];
	if (isExpanded(owner)) {
		for (const action of actions) out.push(`  ${rowLine(action, true)}`);
	}
	return out.map(text => truncateToWidth(text, width));
}

/** Lines of a tool block that has marker data. */
function ownerLines(owner: object, width: number, units: Unit[]): string[] {
	const call = callOf(units);
	if (EXPLORE_TOOLS[call.toolName] !== true) return standaloneLines(owner, call, width);
	const self: Member = { component: owner, actions: [actionOf(call, owner)] };
	const run = exploreRun(owner, width, self);
	const counted = run.some(member => member.actions.some(action => action.row.files + action.row.searches > 0));
	if (!counted) return standaloneLines(owner, call, width);
	return run[0]?.component === owner ? groupLines(owner, run, width) : [];
}

function patchTranscript(): void {
	const proto = TranscriptContainer.prototype;
	if (!claim(proto, "transcript")) return;
	const addChild = proto.addChild;
	proto.addChild = function (this: TranscriptContainer, ...args: Parameters<TranscriptContainer["addChild"]>) {
		addChild.apply(this, args);
		parents.set(args[0], this);
		wrapChild(args[0]);
	};
}

function patchAssistant(): void {
	const proto = AssistantMessageComponent.prototype;
	if (!claim(proto, "assistant")) return;
	const updateContent = proto.updateContent;
	proto.updateContent = function (
		this: AssistantMessageComponent,
		...args: Parameters<AssistantMessageComponent["updateContent"]>
	) {
		assistantMessages.set(this, args[0]);
		return updateContent.apply(this, args);
	};
}

function readEntries(owner: object): Map<string, ReadAction> {
	let map = readGroups.get(owner);
	if (!map) {
		map = new Map();
		readGroups.set(owner, map);
	}
	return map;
}

function patchReadGroup(): void {
	const proto = ReadToolGroupComponent.prototype;
	if (!claim(proto, "read-group")) return;
	const render = proto.render;
	const updateArgs = proto.updateArgs;
	const renameEntry = proto.renameEntry;
	const removeEntry = proto.removeEntry;
	const updateResult = proto.updateResult;
	const setExpanded = proto.setExpanded;
	const setToolActivityVisible = proto.setToolActivityVisible;

	proto.updateArgs = function (this: ReadToolGroupComponent, ...args: Parameters<ReadToolGroupComponent["updateArgs"]>) {
		const [argv, toolCallId] = args;
		if (toolCallId) {
			const entries = readEntries(this);
			const entry = entries.get(toolCallId);
			if (entry) entry.args = argv;
			else entries.set(toolCallId, { args: argv, isPartial: false, startedAt: performance.now() });
		}
		return updateArgs.apply(this, args);
	};
	proto.renameEntry = function (this: ReadToolGroupComponent, ...args: Parameters<ReadToolGroupComponent["renameEntry"]>) {
		const [oldId, newId] = args;
		const entries = readGroups.get(this);
		if (entries?.has(oldId) && newId && !entries.has(newId) && oldId !== newId) {
			const pairs = [...entries].map(([key, value]): [string, ReadAction] => [key === oldId ? newId : key, value]);
			entries.clear();
			for (const [key, value] of pairs) entries.set(key, value);
		}
		return renameEntry.apply(this, args);
	};
	proto.removeEntry = function (this: ReadToolGroupComponent, ...args: Parameters<ReadToolGroupComponent["removeEntry"]>) {
		readGroups.get(this)?.delete(args[0]);
		return removeEntry.apply(this, args);
	};
	proto.updateResult = function (this: ReadToolGroupComponent, ...args: Parameters<ReadToolGroupComponent["updateResult"]>) {
		const [result, isPartial, toolCallId] = args;
		const entry = toolCallId ? readGroups.get(this)?.get(toolCallId) : undefined;
		if (entry) {
			entry.result = result;
			entry.isPartial = isPartial === true;
			if (isPartial !== true) entry.endedAt ??= performance.now();
		}
		return updateResult.apply(this, args);
	};
	proto.setExpanded = function (this: ReadToolGroupComponent, ...args: Parameters<ReadToolGroupComponent["setExpanded"]>) {
		recordExpanded(this, args[0]);
		return setExpanded.apply(this, args);
	};
	proto.setToolActivityVisible = function (
		this: ReadToolGroupComponent,
		...args: Parameters<ReadToolGroupComponent["setToolActivityVisible"]>
	) {
		toolActivityVisible.set(this, args[0]);
		return setToolActivityVisible.apply(this, args);
	};
	proto.render = function (this: ReadToolGroupComponent, width: number) {
		if (!enabled() || toolActivityVisible.get(this) === false) return render.call(this, width);
		try {
			const entries = readGroups.get(this);
			if (!entries || entries.size === 0) return [];
			const self: Member = { component: this, actions: groupActions(entries) };
			const run = exploreRun(this, width, self);
			return run[0]?.component === this ? groupLines(this, run, width) : [];
		} catch {
			return render.call(this, width);
		}
	};
}

function patchToolExecution(): void {
	const proto = ToolExecutionComponent.prototype;
	if (!claim(proto, "tool-execution")) return;
	const render = proto.render;
	const setExecutionStarted = proto.setExecutionStarted;
	const updateResult = proto.updateResult;
	const setExpanded = proto.setExpanded;
	const setToolActivityVisible = proto.setToolActivityVisible;
	const setTranscriptAllocation = proto.setTranscriptAllocation;
	// Blocks whose tool has no marker keep their original view.
	const plain = new WeakSet<object>();

	proto.setExecutionStarted = function (
		this: ToolExecutionComponent,
		...args: Parameters<ToolExecutionComponent["setExecutionStarted"]>
	) {
		const timing = timingOf(this);
		timing.startedAt ??= performance.now();
		return setExecutionStarted.apply(this, args);
	};
	proto.updateResult = function (this: ToolExecutionComponent, ...args: Parameters<ToolExecutionComponent["updateResult"]>) {
		const out = updateResult.apply(this, args);
		if (args[1] !== true) timingOf(this).endedAt ??= performance.now();
		return out;
	};
	proto.setExpanded = function (this: ToolExecutionComponent, ...args: Parameters<ToolExecutionComponent["setExpanded"]>) {
		recordExpanded(this, args[0]);
		return setExpanded.apply(this, args);
	};
	proto.setToolActivityVisible = function (
		this: ToolExecutionComponent,
		...args: Parameters<ToolExecutionComponent["setToolActivityVisible"]>
	) {
		toolActivityVisible.set(this, args[0]);
		return setToolActivityVisible.apply(this, args);
	};
	proto.setTranscriptAllocation = function (
		this: ToolExecutionComponent,
		...args: Parameters<ToolExecutionComponent["setTranscriptAllocation"]>
	) {
		allocations.set(this, Math.max(0, Math.trunc(args[0])));
		return setTranscriptAllocation.apply(this, args);
	};
	proto.render = function (this: ToolExecutionComponent, width: number) {
		const hidden = allocations.get(this) === 0 || toolActivityVisible.get(this) === false;
		if (!enabled() || hidden || (plain.has(this) && !blockKinds.has(this))) return render.call(this, width);
		try {
			const units = collect(this, width);
			// A claimed block (sticky kind) paints its own rows; it may have no marker once a result exists.
			const kind = units.length > 0 ? units[0]!.toolName : blockKinds.get(this);
			const painter = kind === undefined ? undefined : painters.get(kind);
			if (kind !== undefined && painter) {
				blockKinds.set(this, kind);
				return painter(this, width, units.length > 0 ? callOf(units).args : undefined) ?? render.call(this, width);
			}
			if (units.length === 0) {
				if (this.children.length > 0) plain.add(this);
				return render.call(this, width);
			}
			return ownerLines(this, width, units);
		} catch {
			return render.call(this, width);
		}
	};
}

/** Installs the process-wide renderer and prototype patches once. */
export function installCursorFeed(): void {
	installRenderers();
	patchTranscript();
	patchAssistant();
	patchReadGroup();
	patchToolExecution();
}
