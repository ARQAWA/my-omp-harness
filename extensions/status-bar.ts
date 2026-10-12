import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { InteractiveMode, SEGMENTS, StatusLineComponent } from "@oh-my-pi/pi-coding-agent";
import { lookup } from "@oh-my-pi/pi-coding-agent/config/registry";
import { shimmerEnabled, shimmerText, visibleWidth } from "@oh-my-pi/pi-tui";
import { fitLine } from "./cursor-feed/fit";
import { todoPanelLines } from "./cursor-feed/panel";
import { enabled } from "./cursor-feed/state";
import { viewMode } from "./cursor-feed";
import { getAgentTask } from "./cursor-feed/agent-tasks";
import { actionPhrase } from "./cursor-feed/rows";
import { GLYPH } from "./cursor-feed/glyphs";
import { AgentRegistry } from "@oh-my-pi/pi-coding-agent/registry/agent-registry";

const TITLE = "my-omp-harness.title";

let latest: any;
let turnStart: number | undefined;
let lastTurnMs: number | undefined;
let piApi: ExtensionAPI | undefined;
let compacting = false;
let glow: ReturnType<typeof setInterval> | undefined;
let tui: any;
let gitText = "";
let prText = "";
let rateCaptured = "";

interface ActionState {
	thinking: boolean;
	/** Still-running tool calls by toolCallId, in start order. */
	tools: Map<string, { toolName: string; args: unknown }>;
}

interface ActionSlot {
	states: Map<string, ActionState>;
	timer?: ReturnType<typeof setInterval>;
}

// Process-global: the action state of every agent, keyed by agent id.
const ACTION = Symbol.for("my-omp-harness.current-action");
const actions = ((globalThis as Record<symbol, unknown>)[ACTION] ??= { states: new Map<string, ActionState>() }) as ActionSlot;

const lastRateInvalidate = new WeakMap<object, number>();

function rateText(ctx: any): string | undefined {
	const rate = ctx?.session?.tokenRate?.rate?.();
	if (!Number.isFinite(rate)) return undefined;
	const [r, g, b] = rate < 30 ? [255, 71, 87] : rate < 60 ? [255, 215, 95] : rate < 90 ? [168, 230, 163] : [0, 255, 136];
	const icon = latest?.ui?.theme?.icon?.throughput ?? "";
	return `\x1b[38;2;${r};${g};${b}m${icon}${rate.toFixed(1)} tok/s\x1b[39m`;
}

function patchTokenRate() {
	const RATE_PATCHED = Symbol.for("my-omp-harness.rate-color");
	const tokenRate = SEGMENTS?.token_rate as any;
	if (!tokenRate || tokenRate[RATE_PATCHED]) return;
	tokenRate[RATE_PATCHED] = true;
	tokenRate.render = (ctx: any) => {
		rateCaptured = rateText(ctx) ?? "";
		return { content: "", visible: false };
	};
	tokenRate.describe = (ctx: any) => {
		const t = rateText(ctx);
		return t ? { spans: [{ t }] } : null;
	};
}

/** Keeps a right-side segment's text in slot and draws nothing in its place; the status rows draw that text instead. */
function captureSegment(id: "git" | "pr", slot: (text: string) => void): void {
	const segment = (SEGMENTS as any)?.[id];
	if (!segment || !claimOnce(segment, Symbol.for(`my-omp-harness.captured-segment.${id}`))) return;
	const original = segment.render;
	segment.render = (ctx: any) => {
		const result = original.call(segment, ctx);
		slot(result?.visible ? result.content : "");
		return { content: "", visible: false };
	};
	segment.describe = () => null;
}

function patchMode() {
	const MODE_PATCHED = Symbol.for("my-omp-harness.mode-both");
	const mode = SEGMENTS?.mode as any;
	if (!mode || mode[MODE_PATCHED]) return;
	mode[MODE_PATCHED] = true;
	const original = mode.render;
	mode.render = (ctx: any) => {
		if (focusedId() !== undefined) return original({ ...ctx, planMode: undefined, goalMode: undefined, prewalk: undefined });
		const result = original(ctx);
		const planActive = ctx.planMode?.enabled || ctx.planMode?.paused;
		const goalActive = ctx.goalMode?.enabled || ctx.goalMode?.paused;
		if (!planActive || !goalActive) return result;
		const withoutPlan = original({ ...ctx, planMode: undefined, prewalk: undefined });
		if (!withoutPlan?.visible) return result;
		return { ...result, content: `${result.content} ${withoutPlan.content}` };
	};
}

function patchStatusJoin() {
	const STATUS_JOIN_PATCHED = Symbol.for("my-omp-harness.status-join");
	const segment = SEGMENTS?.status as any;
	if (!segment || segment[STATUS_JOIN_PATCHED]) return;
	segment[STATUS_JOIN_PATCHED] = true;
	const originalRender = segment.render;
	const originalDescribe = segment.describe;
	segment.render = (ctx: any) => {
		if (focusedId() !== undefined) return { content: "", visible: false };
		const hooks: unknown[] = Array.isArray(ctx?.hookStatuses) ? ctx.hookStatuses : [];
		if (hooks.length < 2) return originalRender(ctx);
		const theme = latest?.ui?.theme;
		const sep = theme ? ` ${theme.getFgAnsi("statusLineSep")}·${theme.getFgAnsi("text")} ` : " · ";
		const visible = hooks
			.map(item => originalRender({ ...ctx, hookStatuses: [item] }))
			.filter(result => result?.visible);
		if (visible.length === 0) return { content: "", visible: false };
		return { content: visible.map(result => result.content).join(sep), visible: true };
	};
	segment.describe = (ctx: any) => {
		if (focusedId() !== undefined) return null;
		const hooks: unknown[] = Array.isArray(ctx?.hookStatuses) ? ctx.hookStatuses : [];
		if (hooks.length < 2) return originalDescribe(ctx);
		const views = hooks.map(item => originalDescribe({ ...ctx, hookStatuses: [item] })).filter(Boolean);
		if (views.length === 0) return null;
		const spans = views.flatMap((view, index) => [
			...(index > 0 ? [{ t: " · " }] : []),
			...(view.spans ?? []),
		]);
		return { ...views[0], spans };
	};
}

function rowLeftRight(left: string, right: string, width: number): string {
	if (!left && !right) return "";
	if (!left) {
		const part = fitLine(right, width);
		return " ".repeat(Math.max(0, width - visibleWidth(part))) + part;
	}
	if (!right) return fitLine(left, width);
	const lw = visibleWidth(left);
	const rw = visibleWidth(right);
	if (lw + rw <= width) return left + " ".repeat(width - lw - rw) + right;
	const room = width - rw - 1;
	if (room <= 0) return fitLine(right, width);
	const leftPart = fitLine(left, room);
	return leftPart + " ".repeat(Math.max(0, width - visibleWidth(leftPart) - rw)) + right;
}

/** The focused subagent's id while its view is open and the harness is on; undefined for the main session. */
function focusedId(): string | undefined {
	return enabled() ? viewMode()?.focusedAgentId : undefined;
}

/** The session whose context the bar measures: the focused subagent's while its view is open, else the main one. */
function contextSession(): any {
	return focusedId() === undefined ? latest : viewMode()?.viewSession;
}

/** Scales every truecolor RGB channel to 90%, for the darker rows of the focused view. */
function dimRgb(line: string): string {
	const scale = (value: string) => Math.round(Number(value) * 0.9);
	return line.replace(/\x1b\[(38|48);2;(\d+);(\d+);(\d+)m/g, (_seq, layer: string, r: string, g: string, b: string) =>
		`\x1b[${layer};2;${scale(r)};${scale(g)};${scale(b)}m`);
}

function patchStatusLine() {
	const ROWS_PATCHED = Symbol.for("my-omp-harness.status-rows");
	const proto = StatusLineComponent.prototype as any;
	if (proto[ROWS_PATCHED]) return;
	proto[ROWS_PATCHED] = true;
	const render = proto.render;
	const rightPart = proto.getStandaloneTopBorder;
	// The rule composer would put the right segments into the line above the input; keep that line plain.
	proto.getStandaloneTopBorder = () => ({ content: "", width: 0, revision: 0 });
	proto.render = function (width: number) {
		if (turnStart !== undefined) {
			const now = Date.now();
			if (now - (lastRateInvalidate.get(this) ?? 0) >= 80) {
				lastRateInvalidate.set(this, now);
				this.invalidate();
			}
		}
		const base: string[] = render.call(this, width);
		const focused = focusedId() !== undefined;
		const theme = latest?.ui?.theme;
		const k = base.findIndex(line => line !== "");
		if (!theme || k < 0) return focused ? base.map(dimRgb) : base;
		// omp draws the running subagent and background job counters only with the right segments; move them to the model row.
		const agentCount = this.subagentCount;
		const jobCount = this.runningBackgroundJobCount();
		const ompAgents = agentCount > 0 ? theme.fg("statusLineSubagents", `${theme.icon.agents} ${agentCount}`) : "";
		const agents = agentCount > 0 ? theme.fg("statusLineSubagents", `${"\u{F0C0}"} ${agentCount}`) : "";
		const jobs = jobCount > 0 ? theme.fg("statusLineSubagents", `${theme.icon.job} ${jobCount}`) : "";
		const sep = ` ${theme.getFgAnsi("statusLineSep")}·${theme.getFgAnsi("text")} `;
		let model = base[k];
		// Shorten reasoning labels to no lo md hi xh mx; off (between_tools or thinking disabled) shows "no".
		model = model.replace(`${theme.status.disabled} off`, "no");
		for (const [level, short] of [["low", "lo"], ["medium", "md"], ["high", "hi"], ["xhigh", "xh"], ["max", "mx"]] as const) {
			const full = theme.thinking?.[level];
			if (full) model = model.replace(full, short);
		}
		let place: string = rightPart.call(this, width)?.content ?? "";
		const dot = theme.fg("statusLineSep", "·");
		if (agents && !focused) model += `${dot} ${agents}`;
		if (ompAgents) place = place.replace(ompAgents + sep, "");
		if (jobs) place = place.replace(jobs + sep, "");
		const placeAndJobs = jobs ? (place ? `${place} ${dot} ${jobs}` : jobs) : place;
		// Drop omp's blank gap row so the context bar sits right under the input.
		const textColor = theme.getFgAnsi("text");
		const right1 = rateCaptured;
		const row1 = rowLeftRight(model, right1, width);
		const row2 = rowLeftRight(placeAndJobs, [gitText, prText].filter(Boolean).join(" "), width);
		const rows = [contextLine(width, theme, textColor), row1];
		if (row2) rows.push(row2);
		const lines = [...rows, ...base.slice(k + 1)];
		return focused ? lines.map(dimRgb) : lines;
	};
}

function stateOf(agentId: string): ActionState {
	let state = actions.states.get(agentId);
	if (state === undefined) {
		state = { thinking: false, tools: new Map() };
		actions.states.set(agentId, state);
	}
	return state;
}

// The working loader's shimmer cadence.
const THINKING_FRAME_MS = 1000 / 30;

/** The phrase of the current action: the last still-running tool, else Planning next moves while thinking; undefined when idle. tool tells the two apart. */
function phraseOf(state: ActionState | undefined): { text: string; tool: boolean } | undefined {
	if (state === undefined) return undefined;
	let last: { toolName: string; args: unknown } | undefined;
	for (const call of state.tools.values()) last = call;
	if (last !== undefined) return { text: actionPhrase(last.toolName, last.args), tool: true };
	return state.thinking ? { text: "Planning next moves", tool: false } : undefined;
}

/** A state shimmers its Planning row only while it plans with no tool running. */
function animates(state: ActionState): boolean {
	return state.thinking && state.tools.size === 0;
}

// The render ticker runs only while some Planning row is shown and the shimmer is on: ~30fps. Otherwise each state change requests one render.
function refreshAction(): void {
	const animate = shimmerEnabled() && [...actions.states.values()].some(animates);
	if (animate && actions.timer === undefined) {
		actions.timer = setInterval(() => tui?.requestRender?.(), THINKING_FRAME_MS);
		actions.timer.unref?.();
	} else if (!animate && actions.timer !== undefined) {
		clearInterval(actions.timer);
		actions.timer = undefined;
	}
	tui?.requestRender?.();
}

function stopThinking(agentId: string): void {
	const state = actions.states.get(agentId);
	if (state?.thinking !== true) return;
	state.thinking = false;
	refreshAction();
}

/** The current-action row of an agent: a circle and the phrase while it runs a tool, a shimmering Planning phrase while it plans; empty otherwise. */
export function currentActionLines(agentId: string, width: number, theme: any): string[] {
	const phrase = phraseOf(actions.states.get(agentId));
	if (phrase === undefined) return [];
	const line = phrase.tool ? `${theme.fg("warning", GLYPH.circle)} ${phrase.text}` : shimmerText(phrase.text, theme);
	return [fitLine(line, width)];
}

// The status container draws the working row and the idle tok/s row; while cursor-feed is on it draws nothing, and the status bar shows the action line instead.
function patchStatusContainer() {
	const STATUS_CONTAINER_PATCHED = Symbol.for("my-omp-harness.status-container");
	const STATUS_CONTAINER_RENDER = Symbol.for("my-omp-harness.status-container.render");
	const proto = InteractiveMode.prototype;
	const record = proto as unknown as Record<symbol, unknown>;
	if (record[STATUS_CONTAINER_PATCHED]) return;
	record[STATUS_CONTAINER_PATCHED] = true;
	const init = proto.init;
	proto.init = function (this: InteractiveMode, ...args: Parameters<InteractiveMode["init"]>): Promise<void> {
		const container = this.statusContainer as unknown as Drawable;
		if (claimOnce(container, STATUS_CONTAINER_RENDER)) {
			const render = container.render;
			container.render = (width: number): readonly string[] => (enabled() ? [] : render.call(container, width));
		}
		return init.apply(this, args);
	};
}

const COMPOSER_PATCHED = Symbol.for("my-omp-harness.composer-rows");
const CHIPS_EDITOR = Symbol.for("my-omp-harness.composer-rows.editor");
const CHIPS_CONTAINER = Symbol.for("my-omp-harness.composer-rows.container");

interface Drawable {
	render(width: number): readonly string[];
}

/** Sets a guard symbol on the target once; false when it was already set. */
function claimOnce(target: object, key: symbol): boolean {
	const record = target as Record<symbol, unknown>;
	if (record[key]) return false;
	record[key] = true;
	return true;
}

/** The editor draws the attachment chips right under its top rule while the harness is on. */
function installEditorChips(editor: InteractiveMode["editor"]): void {
	if (!claimOnce(editor, CHIPS_EDITOR)) return;
	const target = editor as unknown as Drawable & { attachmentChips?: Drawable };
	const render = target.render;
	target.render = (width: number): readonly string[] => {
		const rows = render.call(target, width);
		if (!enabled()) return rows;
		const chips = target.attachmentChips?.render(width) ?? [];
		if (chips.length === 0) return rows;
		return [...rows.slice(0, 1), ...chips, ...rows.slice(1)];
	};
}

/** The chips container draws nothing while the harness is on; the editor draws the chips instead. */
function installChipsContainer(mode: InteractiveMode): void {
	const container = mode.attachmentChipsContainer as unknown as Drawable;
	if (!claimOnce(container, CHIPS_CONTAINER)) return;
	const render = container.render;
	container.render = (width: number): readonly string[] => {
		installEditorChips(mode.editor);
		return enabled() ? [] : render.call(container, width);
	};
}

/** Wraps the interactive mode's init once so that its editor and chips container get the guarded row renders. */
function patchComposerRows(): void {
	const proto = InteractiveMode.prototype;
	const record = proto as unknown as Record<symbol, unknown>;
	if (record[COMPOSER_PATCHED]) return;
	record[COMPOSER_PATCHED] = true;
	const init = proto.init;
	proto.init = function (this: InteractiveMode, ...args: Parameters<InteractiveMode["init"]>): Promise<void> {
		installEditorChips(this.editor);
		installChipsContainer(this);
		return init.apply(this, args);
	};
}

function fmtWorked(ms: number): string {
	const totalSec = Math.floor(ms / 1000);
	const s = totalSec % 60;
	const totalMin = Math.floor(totalSec / 60);
	const m = totalMin % 60;
	const h = Math.floor(totalMin / 60);
	const ss = String(s).padStart(2, "0");
	if (h > 0) {
		const mm = String(m).padStart(2, "0");
		return `${h}h ${mm}m ${ss}s`;
	}
	if (totalMin > 0) return `${totalMin}m ${ss}s`;
	return `${s}s`;
}

function fmtK(n: number): string {
	if (n >= 1e6) {
		const v = n / 1e6;
		const s = v.toFixed(1);
		return `${s.endsWith(".0") ? s.slice(0, -2) : s}M`;
	}
	const v = n / 1e3;
	const s = v.toFixed(1);
	return `${s.endsWith(".0") ? s.slice(0, -2) : s}k`;
}

function positive(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function setting(key: "compaction.thresholdTokens" | "compaction.thresholdPercent" | "compaction.reserveTokens"): unknown {
	if (!piApi) return undefined;
	try {
		return lookup(key)?.get(piApi.pi.settings);
	} catch {
		return undefined;
	}
}

// The token count at which compaction triggers; the context bar measures against it.
function triggerTokens(cw: number): number {
	const tt = setting("compaction.thresholdTokens");
	if (positive(tt)) return Math.min(cw - 1, Math.max(1, tt));
	const tp = setting("compaction.thresholdPercent");
	if (positive(tp)) return Math.floor(cw * Math.min(99, Math.max(1, tp)) / 100);
	const rt = setting("compaction.reserveTokens");
	const reserve = Math.max(Math.floor(cw * 0.15), positive(rt) ? rt : 16384);
	if (reserve >= cw) return Math.floor(cw * 0.15);
	return Math.max(1, cw - reserve);
}

const GOLD_STOPS: [number, [number, number, number]][] = [[0, [0x8a, 0x6d, 0x1c]], [0.5, [0xc9, 0xa2, 0x27]], [1, [0xe3, 0xc4, 0x5a]]];
const SHEEN = "\x1b[38;2;242;222;138m";
const SHEEN_EDGE = "\x1b[38;2;217;184;74m";

// Truecolor gold at position t (0..1) along the bar: dark at 0, through mid gold at 0.5, to light at 1.
function goldAt(t: number): string {
	const x = Math.min(1, Math.max(0, t));
	let k = 0;
	while (k < GOLD_STOPS.length - 2 && x > GOLD_STOPS[k + 1][0]) k++;
	const [t0, c0] = GOLD_STOPS[k];
	const [t1, c1] = GOLD_STOPS[k + 1];
	const f = t1 === t0 ? 0 : (x - t0) / (t1 - t0);
	const [r, g, b] = c0.map((v, j) => Math.round(v + (c1[j] - v) * f));
	return `\x1b[38;2;${r};${g};${b}m`;
}

/** Bold natural gold across the code points of a title, then resets bold and the foreground. */
function goldBold(text: string): string {
	const chars = Array.from(text);
	const last = chars.length - 1;
	const body = chars.map((ch, i) => `${goldAt(last <= 0 ? 0.5 : i / last)}${ch}`).join("");
	return `\x1b[1m${body}\x1b[22m\x1b[39m`;
}

// Colour of filled cell i while compacting: a sheen band of 6 cells moves along the bar from `start`, lit in SHEEN with its trailing edge and the cell before start in SHEEN_EDGE; other cells keep their gold.
function glowColor(i: number, filled: number, start: number): string {
	const d = (i - start + filled) % filled;
	if (d < 6) return SHEEN;
	if (d === 6 || d === filled - 1) return SHEEN_EDGE;
	return goldAt(filled <= 1 ? 0.5 : i / (filled - 1));
}

function startGlow() {
	compacting = true;
	if (glow === undefined) {
		glow = setInterval(() => tui?.requestRender?.(), 60);
		glow.unref?.();
	}
	tui?.requestRender?.();
}

function stopGlow() {
	compacting = false;
	if (glow !== undefined) {
		clearInterval(glow);
		glow = undefined;
	}
	tui?.requestRender?.();
}

function contextLine(width: number, theme: any, textColor: string): string {
	const u = contextSession()?.getContextUsage?.();
	if (!u?.contextWindow) return theme.fg("dim", "─".repeat(width));
	const t = triggerTokens(u.contextWindow);
	const tokens = u.tokens ?? 0;
	const p = Math.min(100, Math.max(0, tokens / t * 100));
	const full = tokens >= t || compacting;
	const label = ` ${Math.round(p)}% ${fmtK(tokens)}/${fmtK(t)}`;
	const muted = theme.getFgAnsi("muted");
	const barWidth = Math.max(0, width - visibleWidth(label));
	const filled = Math.round((barWidth * p) / 100);
	let fill = "";
	if (!full) {
		fill = `${textColor}${"━".repeat(filled)}`;
	} else {
		const start = compacting && filled > 0 ? Math.floor(Date.now() / 60) % filled : 0;
		for (let i = 0; i < filled; i++) fill += `${compacting ? glowColor(i, filled, start) : goldAt(filled <= 1 ? 0.5 : i / (filled - 1))}━`;
	}
	const line =
		`${fill}\x1b[39m`
		+ theme.fg("dim", "─".repeat(barWidth - filled))
		+ `${muted}${label}\x1b[39m`;
	return fitLine(line, width);
}

function showTitle(ctx: any) {
	ctx.ui.setWidget(
		TITLE,
		(_tui, theme) => (tui = _tui, {
			render(width: number) {
				const focus = focusedId();
				const ref = focus === undefined ? undefined : AgentRegistry.global().get(focus);
				const task = ref ? getAgentTask(ref, () => tui?.requestRender?.()) : undefined;
				const session = focus === undefined ? ctx.sessionManager : viewMode()?.viewSession?.sessionManager;
				const id = session?.getSessionId?.();
				const parts: string[] = [];
				if (focus === undefined) {
					const name = ctx.sessionManager?.getSessionName?.();
					if (name) parts.push(goldBold(name));
					if (turnStart === undefined && lastTurnMs !== undefined) {
						parts.push(theme.fg("dim", `Worked ${fmtWorked(lastTurnMs)}`));
					}
				} else {
					parts.push(goldBold(`Subagent ${focus}${task ? ` #${task.number}` : ""}`));
					if (ref && ref.status !== "running" && task) {
						parts.push(theme.fg("dim", `Worked ${fmtWorked(task.durationMs)}`));
					}
				}
				const left = parts.join(" · ");
				const right = id ? `\x1b[22m${theme.fg("muted", id)}` : "";
				const action = currentActionLines(focus ?? ctx.agent.id, width, theme);
				const rows = [...action, ...(action.length > 0 ? [""] : []), ...todoPanelLines(width)];
				if (focus !== undefined) {
					rows.push(fitLine(theme.fg("error", "alt+x alt+x stops this agent"), width));
				}
				if (!left && !right) return [...rows, ""];
				const row = rowLeftRight(left, right, Math.max(0, width - 2)) + "  ";
				const titleRow = width < 2 ? fitLine(row, width) : row;
				return [...rows, focus === undefined ? titleRow : dimRgb(titleRow)];
			},
			invalidate() {},
		}),
		{ placement: "aboveEditor" },
	);
}

export default function statusBar(pi: ExtensionAPI) {
	piApi = pi;
	patchTokenRate();
	patchMode();
	patchStatusJoin();
	captureSegment("git", text => (gitText = text));
	captureSegment("pr", text => (prText = text));
	patchStatusLine();
	patchStatusContainer();
	patchComposerRows();

	pi.on("session_start", (_event, ctx) => {
		if (!ctx.hasUI) return;
		latest = ctx;
		ctx.ui.setStatus("turn", undefined);
		showTitle(ctx);
	});

	pi.on("session_switch", (_event, ctx) => {
		if (!ctx.hasUI) return;
		latest = ctx;
		lastTurnMs = undefined;
		ctx.ui.setStatus("turn", undefined);
		showTitle(ctx);
	});

	pi.on("before_agent_start", (_event, ctx) => {
		if (!ctx.hasUI) return;
		latest = ctx;
		if (turnStart !== undefined) return;
		turnStart = Date.now();
	});

	// Runs for every agent, subagents included, so the focused view can show their current action.
	pi.on("message_update", (event, ctx) => {
		const update = event.assistantMessageEvent;
		if (update.type === "thinking_start" || update.type === "thinking_delta") {
			const state = stateOf(ctx.agent.id);
			if (state.thinking) return;
			state.thinking = true;
			refreshAction();
		} else if (update.type === "thinking_end" || update.type === "text_start" || update.type === "toolcall_start") {
			stopThinking(ctx.agent.id);
		}
	});

	pi.on("message_end", (_event, ctx) => {
		stopThinking(ctx.agent.id);
	});

	pi.on("tool_execution_start", (event, ctx) => {
		const state = stateOf(ctx.agent.id);
		state.thinking = false;
		state.tools.set(event.toolCallId, { toolName: event.toolName, args: event.args });
		refreshAction();
	});

	pi.on("tool_execution_end", (event, ctx) => {
		const state = actions.states.get(ctx.agent.id);
		if (state?.tools.delete(event.toolCallId)) refreshAction();
	});

	pi.on("agent_end", (event, ctx) => {
		if (!event.willContinue && actions.states.delete(ctx.agent.id)) refreshAction();
		if (!ctx.hasUI) return;
		latest = ctx;
		if (turnStart === undefined) return;
		lastTurnMs = Date.now() - turnStart;
		turnStart = undefined;
		showTitle(ctx);
	});

	pi.on("tool_result", (_event, ctx) => {
		if (!ctx.hasUI) return;
		if (_event.toolName !== "todo") return;
		showTitle(ctx);
	});

	(pi as any).on("auto_compaction_start", (_event: any, ctx: any) => {
		if (!ctx.hasUI) return;
		startGlow();
	});

	(pi as any).on("auto_compaction_end", (_event: any, ctx: any) => {
		if (!ctx.hasUI) return;
		stopGlow();
	});

	(pi as any).on("session_compact", (_event: any, ctx: any) => {
		if (!ctx.hasUI) return;
		stopGlow();
	});

	pi.on("session_start", (_event, ctx) => {
		if (!ctx.hasUI) return;
		stopGlow();
	});

	pi.on("session_switch", (_event, ctx) => {
		if (!ctx.hasUI) return;
		stopGlow();
	});
}
