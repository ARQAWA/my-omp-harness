import { AssistantMessageComponent, ReadToolGroupComponent, ToolExecutionComponent } from "@oh-my-pi/pi-coding-agent";
import { type Component, Container, MetricRow, Spacer, theme, type ThemeColor, visibleWidth } from "@oh-my-pi/pi-tui";
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
	setToolNameResolver,
	type Timing,
	timings,
	toolActivityVisible,
} from "./state";
import {
	bodyOf,
	countsText,
	displayPath,
	editResultRow,
	editResults,
	formatElapsed,
	joinsRun,
	type Line,
	type Row,
	readRow,
	rowOf,
	type Status,
	statusOf,
	writeFiles,
} from "./rows";
import { goalToolLines, type TodoPhase, todoRowLine } from "./cards";
import { wrapChild } from "./turn";
import { fitLine } from "./fit";
import { GLYPH } from "./glyphs";

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
	/** The original view of a call with no marker: its call and output, shown when expanded. */
	view?: () => string[];
}

interface Action {
	row: Row;
	status: Status;
	durationMs?: number;
	/** The tool name, which picks the row glyph. */
	tool: string;
}

/** A part of an Explored run: the actions of one component, or one error action that breaks the run. */
interface Segment {
	component: object;
	actions: Action[];
	/** The call of a tool block; read groups have none. */
	call?: Call;
	error: boolean;
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

/** The native render of a tool block, bypassing the feed; set once the feed patches tool blocks. */
let nativeRender: ((owner: ToolExecutionComponent, width: number) => readonly string[]) | undefined;

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
		tool: call.toolName,
	};
}

/** A plain record view of an unknown value; empty when it is not an object. */
function recordOf(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

/** One row per file of a write call; a file's status comes from its entry in the result's files. */
function writeActions(call: Call, owner: object): Action[] {
	const durationMs = durationOf(timings.get(owner));
	const entries = call.results.flatMap(result => {
		const files = recordOf(result.details).files;
		return Array.isArray(files) ? files.map(item => recordOf(item)) : [];
	});
	return writeFiles(call.args).map((file, index) => {
		const entry = entries.find(item => item.path === file.path);
		const status: Status =
			entry === undefined ? statusOf(call.results, call.isPartial) : entry.status === "written" ? "done" : "error";
		return {
			row: { verb: "Wrote", detail: displayPath(file.path), added: file.added, files: 0, searches: 0, edits: 1 },
			status,
			durationMs: index === 0 ? durationMs : undefined,
			tool: call.toolName,
		};
	});
}

/** The actions of a standalone call: one per edited file when an edit call has several results, else one. */
function actionsOf(call: Call, owner: object): Action[] {
	if (call.toolName === "write") return writeActions(call, owner);
	const per = editResults(call.toolName, call.results);
	if (per.length === 0) return [actionOf(call, owner)];
	const durationMs = durationOf(timings.get(owner));
	return per.map((result, index) => ({
		row: editResultRow(result),
		status: statusOf([result], call.isPartial),
		durationMs: index === 0 ? durationMs : undefined,
		tool: call.toolName,
	}));
}

function groupActions(map: Map<string, ReadAction>): Action[] {
	const actions: Action[] = [];
	for (const entry of map.values()) {
		actions.push({
			row: readRow(entry.args),
			status: statusOf(entry.result ? [entry.result] : [], entry.isPartial),
			durationMs: durationOf(entry),
			tool: "read",
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

/** A call that keeps a row of its own: a failed call breaks the run and is shown alone. */
function isOwnRow(call: Call): boolean {
	return statusOf(call.results, call.isPartial) === "error";
}

/** Classifies a transcript sibling: its segments of an Explored run, skipped (transparent), or a run boundary. */
function classify(sibling: object, width: number): Segment[] | "skip" | "stop" {
	if (sibling instanceof ReadToolGroupComponent) {
		const map = readGroups.get(sibling);
		if (!map || map.size === 0) return "skip";
		return segmentsOf(sibling, groupActions(map));
	}
	if (sibling instanceof ToolExecutionComponent) {
		const call = blockCall(sibling, width);
		if (call === undefined || !joinsRun(call.toolName, call.args) || isOwnRow(call)) return "stop";
		return [{ component: sibling, actions: actionsOf(call, sibling), call, error: false }];
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

/** The end of a detail that fits the room, with "…" in front when its start is cut. */
function tailDetail(detail: string, room: number): string {
	if (visibleWidth(detail) <= room) return detail;
	const kept: string[] = [];
	let used = 0;
	for (const char of [...detail].reverse()) {
		const size = visibleWidth(char);
		if (used + size > room - 1) break;
		kept.unshift(char);
		used += size;
	}
	return `…${kept.join("")}`;
}

/** One tool row: glyph, verb, detail, stats and elapsed time; a long detail loses its start to fit the width. */
function rowLine(action: Action, withElapsed: boolean, width: number, indent = ""): string {
	const { row } = action;
	const stats = [
		row.added === undefined ? "" : paint(TONE.added, `+${row.added}`),
		row.removed === undefined ? "" : paint(TONE.removed, `−${row.removed}`),
	]
		.filter(Boolean)
		.join(" ");
	const time =
		withElapsed && action.durationMs !== undefined ? paint("dim", `· ${formatElapsed(action.durationMs)}`) : "";
	const tail = [stats, time].filter(Boolean).join(" ");
	const tailText = tail === "" ? "" : ` ${tail}`;
	const head = `${indent}${paint(DOT[action.status], GLYPH.circle)} ${row.verb}`;
	const whole = row.detail === "" ? `${head}${tailText}` : `${head} ${paint("dim", row.detail)}${tailText}`;
	if (visibleWidth(whole) <= width) return whole;
	if (row.detail === "") return fitLine(whole, width);
	const room = width - visibleWidth(head) - visibleWidth(tailText) - 1;
	if (room < 1) return `${fitLine(head, width - visibleWidth(tailText))}${tailText}`;
	return `${head} ${paint("dim", tailDetail(row.detail, room))}${tailText}`;
}

/** Settled todo blocks' phases, cached per owner once the owner's own call has settled. */
const todoPhaseCache = new WeakMap<object, { phases: TodoPhase[] | undefined }>();
const toolNames = new WeakMap<object, string>();

/** The phases of a result's details, when they are an array. */
function phasesOf(result: CallResult): TodoPhase[] | undefined {
	const details = result.details;
	if (typeof details !== "object" || details === null) return undefined;
	const phases = (details as { phases?: unknown }).phases;
	return Array.isArray(phases) ? (phases as TodoPhase[]) : undefined;
}

/** Phases of the nearest earlier todo block that has them. */
function previousTodoPhases(owner: object): TodoPhase[] | undefined {
	const cached = todoPhaseCache.get(owner);
	if (cached) return cached.phases;
	let found: TodoPhase[] | undefined;
	const siblings = parents.get(owner)?.children;
	const index = siblings ? siblings.indexOf(owner) : -1;
	for (let i = index - 1; siblings && i >= 0 && found === undefined; i--) {
		const sibling = siblings[i]!;
		if (!(sibling instanceof ToolExecutionComponent)) continue;
		const units = collect(sibling, 80);
		if (units[0]?.toolName !== "todo") continue;
		const result = callOf(units).results.find(item => phasesOf(item) !== undefined);
		if (result) found = phasesOf(result);
	}
	const own = callOf(collect(owner, 80));
	if (own.results.length > 0 && !own.isPartial) todoPhaseCache.set(owner, { phases: found });
	return found;
}

/** What a block without a marker was given through the public update methods: its args and latest result. */
interface Capture {
	args?: unknown;
	result?: CallResult;
	isPartial: boolean;
}
const captures = new WeakMap<object, Capture>();

function captureOf(owner: object): Capture {
	let capture = captures.get(owner);
	if (!capture) {
		capture = { isPartial: false };
		captures.set(owner, capture);
	}
	return capture;
}

/** The tool name of a block from its public role `omp.tool.<name>`; undefined for tasks, which keep their own view. */
function roleToolName(component: ToolExecutionComponent): string | undefined {
	const props: unknown = component.describe().p;
	const role = typeof props === "object" && props !== null && "role" in props ? props.role : undefined;
	if (typeof role !== "string" || !role.startsWith("omp.tool.")) return undefined;
	const name = role.slice("omp.tool.".length);
	return SKIPPED[name] === true ? undefined : name;
}

/** The call of a block without a marker: its role name with the captured args and result. */
function markerlessCall(component: ToolExecutionComponent, width: number): Call | undefined {
	const toolName = roleToolName(component);
	if (toolName === undefined) return undefined;
	const capture = captures.get(component);
	const result = capture?.result;
	return {
		toolName,
		args: capture?.args,
		results: result === undefined ? [] : [result],
		isPartial: capture?.isPartial === true,
		view: () => [...(nativeRender?.(component, width) ?? [])],
	};
}

/** The call of a tool block: its marker data, else its markerless call. */
function blockCall(component: ToolExecutionComponent, width: number): Call | undefined {
	const units = collect(component, width);
	return units.length > 0 ? callOf(units) : markerlessCall(component, width);
}

/** Tool name of a transcript block, cached once known. */
function resolveToolName(component: object): string | undefined {
	if (!(component instanceof ToolExecutionComponent)) return undefined;
	const cached = toolNames.get(component);
	if (cached !== undefined) return cached;
	const name = collect(component, 80)[0]?.toolName ?? roleToolName(component);
	if (name !== undefined) toolNames.set(component, name);
	return name;
}

function standaloneLines(owner: object, call: Call, width: number): string[] {
	const status = statusOf(call.results, call.isPartial);
	if (call.toolName === "todo") return [todoRowLine(call.args, call.results, previousTodoPhases(owner), status, width)];
	if (call.toolName === "goal") return goalToolLines(call.args, call.results, status, isExpanded(owner), width);
	const out = actionsOf(call, owner).map(action => rowLine(action, true, width));
	if (isExpanded(owner)) {
		out.push(...bodyOfCall(call).map(text => `  ${text}`));
	}
	return out.map(text => fitLine(text, width));
}

/** The totals of one count over the actions. */
function totalOf(actions: Action[], field: "files" | "searches" | "tools" | "commands" | "edits"): number {
	return actions.reduce((sum, action) => sum + (action.row[field] ?? 0), 0);
}

/** The last six lines of an expanded call: its original view when it has no marker, else its body rows. */
function bodyOfCall(call: Call): string[] {
	const lines = call.view
		? call.view()
		: bodyOf(call.toolName, call.args, call.results).map(line => paint(TONE[line.tone], line.text));
	return lines.slice(-6);
}

/** The segments of a read group's actions: each run of successful reads, and each error alone. */
function segmentsOf(component: object, actions: Action[]): Segment[] {
	const segments: Segment[] = [];
	for (const action of actions) {
		const last = segments[segments.length - 1];
		const failed = action.status === "error";
		if (!failed && last && !last.error) last.actions.push(action);
		else segments.push({ component, actions: [action], error: failed });
	}
	return segments;
}

/** The segments on one side of a component, in transcript order; the walk stops at a run boundary. */
function neighbors(owner: object, width: number, direction: -1 | 1): Segment[] {
	const found: Segment[] = [];
	const siblings = parents.get(owner)?.children;
	const index = siblings ? siblings.indexOf(owner) : -1;
	if (!siblings || index < 0) return found;
	for (let i = index + direction; i >= 0 && i < siblings.length; i += direction) {
		const seen = classify(siblings[i]!, width);
		if (seen === "stop") break;
		if (seen === "skip") continue;
		const ordered = direction > 0 ? seen : [...seen].reverse();
		let barrier = false;
		for (const segment of ordered) {
			if (segment.error) {
				barrier = true;
				break;
			}
			if (direction > 0) found.push(segment);
			else found.unshift(segment);
		}
		if (barrier) break;
	}
	return found;
}

/** The header and rows of one Explored run; each member's body follows its rows when expanded. */
function groupLines(owner: object, run: Segment[], width: number): string[] {
	const actions = run.flatMap(segment => segment.actions);
	const running = actions.some(action => action.status === "running");
	const timed = actions.flatMap(action => (action.durationMs === undefined ? [] : [action.durationMs]));
	const total = timed.reduce((sum, ms) => sum + ms, 0);
	const elapsed = timed.length > 0 ? ` ${paint("dim", `· ${formatElapsed(total)}`)}` : "";
	const counts = countsText(
		totalOf(actions, "files"),
		totalOf(actions, "searches"),
		totalOf(actions, "tools"),
		totalOf(actions, "commands"),
		totalOf(actions, "edits"),
	);
	const status: Status = running ? "running" : "done";
	const out = [`${paint(DOT[status], GLYPH.circle)} ${running ? "Exploring" : "Explored"} ${paint("dim", counts)}${elapsed}`];
	if (isExpanded(owner)) {
		for (const segment of run) {
			for (const action of segment.actions) out.push(rowLine(action, true, width, "  "));
			if (segment.call) out.push(...bodyOfCall(segment.call).map(text => `    ${text}`));
		}
	}
	return out;
}

/** The segments of the Explored run around one segment: the neighbors join only at the run's two ends. */
function runAround(owner: object, width: number, segments: Segment[], index: number): Segment[] {
	const before = index === 0 ? neighbors(owner, width, -1) : [];
	const after = index === segments.length - 1 ? neighbors(owner, width, 1) : [];
	return [...before, segments[index]!, ...after];
}

/** Lines a component owns in its Explored runs: a header for each run it starts, and each error as its own row. */
function exploreLines(owner: object, width: number, segments: Segment[]): string[] {
	const out: string[] = [];
	segments.forEach((segment, index) => {
		if (segment.error) {
			for (const action of segment.actions) out.push(rowLine(action, true, width));
			return;
		}
		const run = runAround(owner, width, segments, index);
		if (run[0] === segment) out.push(...groupLines(owner, run, width));
	});
	return out.map(text => fitLine(text, width));
}

/** Lines of a tool block: its own card, or its part of the Explored run it joins. */
function ownerLines(owner: object, width: number, call: Call): string[] {
	if (!joinsRun(call.toolName, call.args) || isOwnRow(call)) return standaloneLines(owner, call, width);
	const segments: Segment[] = [{ component: owner, actions: actionsOf(call, owner), call, error: false }];
	const run = runAround(owner, width, segments, 0);
	const counted = run.some(segment => segment.actions.some(action => action.row.files + action.row.searches > 0));
	if (run.length < 2 && !counted) return standaloneLines(owner, call, width);
	return exploreLines(owner, width, segments);
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
			return exploreLines(this, width, segmentsOf(this, groupActions(entries)));
		} catch {
			return render.call(this, width);
		}
	};
}

function patchToolExecution(): void {
	const proto = ToolExecutionComponent.prototype;
	if (!claim(proto, "tool-execution")) return;
	const render = proto.render;
	nativeRender = (owner, width) => render.call(owner, width);
	const setExecutionStarted = proto.setExecutionStarted;
	const updateResult = proto.updateResult;
	const setExpanded = proto.setExpanded;
	const setToolActivityVisible = proto.setToolActivityVisible;
	const setTranscriptAllocation = proto.setTranscriptAllocation;
	const updateArgs = proto.updateArgs;
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
	proto.updateArgs = function (this: ToolExecutionComponent, ...args: Parameters<ToolExecutionComponent["updateArgs"]>) {
		captureOf(this).args = args[0];
		return updateArgs.apply(this, args);
	};
	proto.updateResult = function (this: ToolExecutionComponent, ...args: Parameters<ToolExecutionComponent["updateResult"]>) {
		const capture = captureOf(this);
		if (isCallResult(args[0])) capture.result = args[0];
		capture.isPartial = args[1] === true;
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
			const call = units.length > 0 ? callOf(units) : markerlessCall(this, width);
			if (call === undefined) {
				if (this.children.length > 0) plain.add(this);
				return render.call(this, width);
			}
			return ownerLines(this, width, call);
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
	setToolNameResolver(resolveToolName);
}
