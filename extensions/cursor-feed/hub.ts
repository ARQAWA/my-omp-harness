import { InteractiveMode } from "@oh-my-pi/pi-coding-agent";
import { type AgentRef, AgentRegistry } from "@oh-my-pi/pi-coding-agent/registry/agent-registry";
import {
	isKeyRelease,
	matchesKey,
	theme,
	type ThemeColor,
	visibleWidth,
	wrapTextWithAnsi,
} from "@oh-my-pi/pi-tui";
import { type AgentTask, getAgentTask } from "./agent-tasks";
import { fitLine } from "./fit";
import { GLYPH } from "./glyphs";
import { type AgentRecord, agentRecords } from "./state";

/** Options of omp's InteractiveMode.showAgentHub; the board reads only requireContent. */
interface AgentHubOpenOptions {
	requireContent?: boolean;
	armCloseTap?: boolean;
	initialSection?: "agents" | "activity";
}

/** The one state an agent shows on the board. */
type Verdict = "Working" | "Idle" | "Done" | "Failed" | "Stopped";

/** One sub-agent of the registry with its latest record and verdict. */
interface Row {
	ref: AgentRef;
	record: AgentRecord | undefined;
	task: AgentTask | undefined;
	verdict: Verdict;
}

/** The TUI parts the board draws with. */
interface BoardHost {
	readonly terminal: { readonly rows: number };
	requestRender(): void;
}

/** What the board asks its host to do on a key press. */
interface BoardActions {
	close(): void;
	open(id: string): void;
}

const LABEL_WIDTH = 8;
const LIST_LINES = 3;
const SPLIT_MIN_WIDTH = 60;
const TASK_LINES = 4;
const NOW_LINES = 2;
const RESULT_LINES = 6;
const ERROR_LINES = 3;
const EMPTY_TEXT = "No agents yet. Agents started with the task tool show up here.";
const THINKING_SUFFIX = /:(off|minimal|low|medium|high|xhigh|max)$/;
export const ASSIGNMENT = /^\s*Complete assignment thoroughly:\s*/i;
const VERDICT: Record<Verdict, { glyph: string; color: ThemeColor }> = {
	Working: { glyph: GLYPH.circle, color: "success" },
	Idle: { glyph: GLYPH.circle, color: "warning" },
	Done: { glyph: GLYPH.circle, color: "dim" },
	Failed: { glyph: GLYPH.circle, color: "error" },
	Stopped: { glyph: GLYPH.circle, color: "error" },
};

/** The open board and the way to hide its overlay; undefined while closed. */
let active: { board: AgentBoard; hide: () => void } | undefined;

function oneLine(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

/** Seconds with one decimal under 10 s, whole seconds under a minute, then m and s. */
export function formatElapsed(ms: number): string {
	const safe = Math.max(0, ms);
	if (safe < 10_000) return `${(safe / 1000).toFixed(1)}s`;
	const total = Math.floor(safe / 1000);
	if (total < 60) return `${total}s`;
	return `${Math.floor(total / 60)}m ${String(total % 60).padStart(2, "0")}s`;
}

/** The current action of an agent: its latest intent, else its tool and args; empty when none. */
export function actionText(intent: string | undefined, tool: string | undefined, args: string | undefined): string {
	const text = oneLine(intent ?? "");
	if (text) return text;
	return tool ? oneLine(`${tool} ${args ?? ""}`) : "";
}

/** A line cut at its end with an ellipsis, or padded, to exactly the width. */
function fit(text: string, width: number): string {
	return fitLine(text, width, true);
}

/** Left and right text on one line of the width; the right text sits at the far end. */
function spread(left: string, right: string, width: number): string {
	const gap = width - visibleWidth(left) - visibleWidth(right);
	if (gap < 1) return fit(`${left} ${right}`, width);
	return `${left}${" ".repeat(gap)}${right}`;
}

/** Wraps text to the width and keeps at most `limit` lines; no lines for blank text. */
function wrapLines(text: string, width: number, limit: number): string[] {
	const trimmed = text.replace(/\r/g, "").replace(/\s+$/, "");
	if (!trimmed) return [];
	const rows: string[] = [];
	for (const line of trimmed.split("\n")) {
		if (rows.length >= limit) break;
		rows.push(...(line ? wrapTextWithAnsi(line.replace(/\t/g, "    "), width) : [""]));
	}
	return rows.slice(0, limit);
}

function verdictOf(ref: AgentRef, record: AgentRecord | undefined): Verdict {
	if (ref.status === "running") return "Working";
	if (ref.status === "aborted" || record?.status === "aborted") return "Stopped";
	if (record?.status === "failed") return "Failed";
	if (ref.status === "parked") return "Done";
	if (record?.status === "completed" || ref.lifecycle?.acceptedAt !== undefined) return "Done";
	return "Idle";
}

/** Place of a verdict in the list: Working first, Idle next, the rest after. */
function rankOf(verdict: Verdict): number {
	if (verdict === "Working") return 0;
	return verdict === "Idle" ? 1 : 2;
}

/** Sub-agents of the registry, Working first, Idle next, then the newest activity first. */
function listRows(onReady?: () => void): Row[] {
	return AgentRegistry.global()
		.list()
		.filter(ref => ref.kind === "sub")
		.map((ref): Row => {
			const record = agentRecords.get(ref.id);
			return { ref, record, task: getAgentTask(ref, onReady), verdict: verdictOf(ref, record) };
		})
		.sort((a, b) => rankOf(a.verdict) - rankOf(b.verdict) || b.ref.lastActivity - a.ref.lastActivity);
}

function elapsedOf(row: Row, now: number): number {
	const task = row.task;
	if (!task) return 0;
	if (row.verdict === "Working") return Math.max(0, now - task.startedAt);
	return task.durationMs;
}

/** The elapsed time text, or empty when the time is 0 or unknown. */
function elapsedTextOf(row: Row, now: number): string {
	const ms = elapsedOf(row, now);
	return Number.isFinite(ms) && ms > 0 ? formatElapsed(ms) : "";
}

/** The task text without omp's assignment prefix and markdown heading lines; blank lines dropped. */
function taskTextOf(task: string | undefined): string {
	return (task ?? "")
		.replace(ASSIGNMENT, "")
		.split("\n")
		.filter(line => !line.startsWith("#"))
		.map(line => line.replace(/\s+$/, ""))
		.filter(line => line !== "")
		.join("\n");
}

function descriptionOf(row: Row): string {
	const description = oneLine(row.record?.description ?? "");
	return description || oneLine(taskTextOf(row.record?.task).split("\n")[0] ?? "");
}

/** Model without its provider prefix or thinking suffix, then the thinking level. */
function modelOf(row: Row): string {
	const model = (row.record?.model ?? row.ref.history?.resolvedModel ?? "")
		.replace(/^[^/]+\//, "")
		.replace(THINKING_SUFFIX, "");
	return [model, row.record?.thinking ?? ""].filter(Boolean).join(" ");
}

function usageOf(task: AgentTask): string {
	const parts: string[] = [];
	if (task.tokens) {
		const shown = task.tokens < 1000 ? String(task.tokens) : `${(task.tokens / 1000).toFixed(1)}k`;
		parts.push(`${shown} ${task.tokens === 1 ? "token" : "tokens"}`);
	}
	if (task.toolCount) {
		parts.push(task.toolCount === 1 ? "1 tool" : `${task.toolCount} tools`);
	}
	if (task.requests) {
		parts.push(task.requests === 1 ? "1 request" : `${task.requests} requests`);
	}
	return parts.join(" · ");
}

function clockOf(ms: number): string {
	const date = new Date(ms);
	return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function emptyLines(width: number, height: number): string[] {
	const lines = Array.from({ length: height }, () => fit("", width));
	if (height > 0) {
		const pad = Math.max(0, Math.floor((width - visibleWidth(EMPTY_TEXT)) / 2));
		lines[Math.floor(height / 2)] = fit(`${" ".repeat(pad)}${theme.fg("dim", EMPTY_TEXT)}`, width);
	}
	return lines;
}

function headerLine(rows: Row[], width: number): string {
	const count = (verdicts: Verdict[]): number => rows.filter(row => verdicts.includes(row.verdict)).length;
	const parts: string[] = [];
	const working = count(["Working"]);
	const idle = count(["Idle"]);
	const done = count(["Done"]);
	const failed = count(["Failed", "Stopped"]);
	if (working > 0) parts.push(theme.fg("success", `${working} working`));
	if (idle > 0) parts.push(theme.fg("warning", `${idle} idle`));
	if (done > 0) parts.push(theme.fg("dim", `${done} done`));
	if (failed > 0) parts.push(theme.fg("error", `${failed} failed`));
	const title = theme.bold(" Agents");
	const left = parts.length > 0 ? `${title}   ${parts.join(theme.fg("dim", " · "))}` : title;
	return spread(left, theme.fg("dim", "esc close"), width);
}

function footerLine(current: Row | undefined, width: number): string {
	const key = (name: string, word: string): string => `${theme.fg("text", name)}${theme.fg("dim", ` ${word}`)}`;
	const parts = [key("↑↓", "select")];
	if (current && current.verdict !== "Stopped") parts.push(key("enter", "open"));
	if (current && current.verdict === "Working") parts.push(key("x", "stop"));
	parts.push(key("esc", "close"));
	return fit(` ${parts.join("   ")}`, width);
}

/** Two lines per agent: mark, status glyph, id and elapsed time; then the dim description. */
function itemLines(row: Row, selected: boolean, width: number, now: number): string[] {
	const style = VERDICT[row.verdict];
	const mark = selected ? theme.fg("text", "▌") : " ";
	const label = `${row.ref.id} #${row.task?.number ?? "?"}`;
	const id = selected ? theme.bold(label) : label;
	const elapsedText = elapsedTextOf(row, now);
	const elapsed = elapsedText ? theme.fg("dim", elapsedText) : "";
	const title = `${mark} ${theme.fg(style.color, style.glyph)} ${id}`;
	const description = descriptionOf(row);
	const lines = [
		fit(spread(title, elapsed, width), width),
		fit(`    ${description ? theme.fg("dim", description) : ""}`, width),
	];
	return selected ? lines.map(line => theme.bg("selectedBg", line)) : lines;
}

/** The agent list, scrolled so the selected agent stays visible; exactly `height` lines. */
function listLines(rows: Row[], index: number, width: number, height: number, now: number): string[] {
	const capacity = Math.max(1, Math.floor(height / LIST_LINES));
	const start = Math.max(0, index - capacity + 1);
	const lines: string[] = [];
	rows.slice(start, start + capacity).forEach((row, offset) => {
		lines.push(...itemLines(row, start + offset === index, width, now), fit("", width));
	});
	while (lines.length < height) lines.push(fit("", width));
	return lines.slice(0, height);
}

/** The card of the selected agent: label column, then the values wrapped to the card width. */
function cardLines(row: Row, now: number, width: number): string[] {
	const { ref, record } = row;
	const style = VERDICT[row.verdict];
	const valueWidth = Math.max(1, width - LABEL_WIDTH);
	const lines: string[] = [
		spread(theme.bold(`${ref.id} #${row.task?.number ?? "?"}`), theme.fg(style.color, row.verdict), width),
	];
	const meta = [record?.agent || row.ref.history?.agent || "", modelOf(row)].filter(Boolean).join(" · ");
	lines.push(fit(theme.fg("dim", meta), width), fit("", width));
	const field = (label: string, values: string[], color?: ThemeColor): void => {
		values.forEach((value, index) => {
			const name = index === 0 ? theme.fg("dim", label.padEnd(LABEL_WIDTH)) : " ".repeat(LABEL_WIDTH);
			lines.push(fit(`${name}${color ? theme.fg(color, value) : value}`, width));
		});
	};
	const description = oneLine(record?.description ?? "");
	const taskValues = [
		...(description ? wrapLines(description, valueWidth, 1) : []),
		...wrapLines(taskTextOf(record?.task), valueWidth, TASK_LINES),
	];
	field("Task", taskValues);
	if (row.verdict === "Working") {
		const action = actionText(record?.lastIntent, record?.currentTool, record?.currentToolArgs) || ref.activity || "";
		field("Now", wrapLines(action, valueWidth, NOW_LINES));
	}
	if (row.verdict === "Done") field("Result", wrapLines(record?.output ?? "", valueWidth, RESULT_LINES), "dim");
	if (row.verdict === "Failed") field("Error", wrapLines(record?.error ?? "", valueWidth, ERROR_LINES), "error");
	const startedAt = row.task?.startedAt ?? 0;
	const timeParts = [
		elapsedTextOf(row, now),
		Number.isFinite(startedAt) && startedAt > 0 ? `started ${clockOf(startedAt)}` : "",
	].filter(Boolean);
	field("Time", timeParts.length > 0 ? [timeParts.join(" · ")] : []);
	const usage = row.task ? usageOf(row.task) : "";
	field("Usage", usage ? [usage] : []);
	return lines;
}

/** The body between the rules: the list alone when narrow, the list and the card when wide. */
function bodyLines(rows: Row[], index: number, width: number, height: number, now: number): string[] {
	const current = rows[index];
	if (!current) return emptyLines(width, height);
	if (width < SPLIT_MIN_WIDTH) return listLines(rows, index, width, height, now);
	const leftWidth = Math.floor((width - 3) / 2);
	const rightWidth = width - 3 - leftWidth;
	const left = listLines(rows, index, leftWidth, height, now);
	const right = cardLines(current, now, rightWidth);
	const divider = theme.fg("border", " │ ");
	return left.map((line, i) => `${line}${divider}${right[i] ?? fit("", rightWidth)}`);
}

/** The agent board: a fullscreen overlay listing the sub-agents, with the selected agent's card. */
class AgentBoard {
	private selectedId: string | undefined;
	private readonly host: BoardHost;
	private readonly actions: BoardActions;
	private readonly unsubscribe: () => void;
	private readonly timer: NodeJS.Timeout;

	constructor(host: BoardHost, actions: BoardActions) {
		this.host = host;
		this.actions = actions;
		this.unsubscribe = AgentRegistry.global().onChange(() => this.host.requestRender());
		this.timer = setInterval(() => this.host.requestRender(), 1000);
		this.timer.unref?.();
	}

	/** Stops the live updates; called once when the board closes. */
	dispose(): void {
		this.unsubscribe();
		clearInterval(this.timer);
	}

	invalidate(): void {}

	render(width: number): string[] {
		const height = this.host.terminal.rows;
		try {
			return this.draw(width, height);
		} catch {
			return Array.from({ length: height }, () => fit("", width));
		}
	}

	handleInput(data: string): void {
		if (isKeyRelease(data)) return;
		if (matchesKey(data, "escape") || matchesKey(data, "q")) {
			this.actions.close();
			return;
		}
		const rows = listRows();
		const index = this.indexIn(rows);
		const current = rows[index];
		if (matchesKey(data, "up") || matchesKey(data, "k")) {
			this.move(rows, index - 1);
		} else if (matchesKey(data, "down") || matchesKey(data, "j")) {
			this.move(rows, index + 1);
		} else if (current && current.verdict !== "Stopped" && matchesKey(data, "enter")) {
			this.actions.open(current.ref.id);
		} else if (current && current.verdict === "Working" && current.ref.session && matchesKey(data, "x")) {
			try {
				void Promise.resolve(current.ref.session.abort()).catch(() => undefined);
			} catch {
				// The agent keeps running; the board shows its state either way.
			}
		}
	}

	private draw(width: number, height: number): string[] {
		const now = Date.now();
		const rows = listRows(() => this.host.requestRender());
		const index = this.indexIn(rows);
		const current = rows[index];
		const bodyHeight = Math.max(0, height - 4);
		const rule = theme.fg("border", "─".repeat(width));
		const body = bodyLines(rows, index, width, bodyHeight, now);
		return [headerLine(rows, width), rule, ...body, rule, footerLine(current, width)];
	}

	private indexIn(rows: Row[]): number {
		const found = rows.findIndex(row => row.ref.id === this.selectedId);
		return found < 0 ? 0 : found;
	}

	private move(rows: Row[], index: number): void {
		const next = rows[Math.min(rows.length - 1, Math.max(0, index))];
		if (!next) return;
		this.selectedId = next.ref.id;
		this.host.requestRender();
	}
}

function closeBoard(mode: InteractiveMode): void {
	const current = active;
	if (!current) return;
	active = undefined;
	current.board.dispose();
	current.hide();
	mode.ui.setFocus(mode.editorContainer.children[0] ?? mode.editor);
	mode.ui.requestRender();
}

function openBoard(mode: InteractiveMode, options: AgentHubOpenOptions | undefined): void {
	if (active) return;
	if (options?.requireContent && listRows().length === 0) return;
	const board = new AgentBoard(mode.ui, {
		close: () => closeBoard(mode),
		open: id => {
			closeBoard(mode);
			try {
				void mode.focusAgentSession(id).catch(() => undefined);
			} catch {
				// The board is closed either way.
			}
		},
	});
	const handle = mode.ui.showOverlay(board, {
		anchor: "bottom-center",
		width: "100%",
		maxHeight: "100%",
		margin: 0,
		fullscreen: true,
	});
	active = { board, hide: () => handle.hide() };
	mode.ui.setFocus(board);
	mode.ui.requestRender();
}

/** Whether the agent board overlay is open. */
export function isAgentBoardOpen(): boolean {
	return active !== undefined;
}

/** Replaces omp's Agent Hub with the agent board; every opener of showAgentHub reaches it. Installed once per process. */
export function installAgentBoard(): void {
	const proto = InteractiveMode.prototype;
	const record = proto as unknown as Record<symbol, unknown>;
	const key = Symbol.for("my-omp-harness.cursor-feed.hub");
	if (record[key]) return;
	record[key] = true;
	const showAgentHub = proto.showAgentHub;
	proto.showAgentHub = function (this: InteractiveMode, options?: AgentHubOpenOptions): void {
		if (this.collabGuest) {
			showAgentHub.call(this, options);
			return;
		}
		try {
			openBoard(this, options);
		} catch {
			if (!active) showAgentHub.call(this, options);
		}
	};
}
