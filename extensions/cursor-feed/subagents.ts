import { SubagentHudComponent, ToolExecutionComponent, UserMessageComponent } from "@oh-my-pi/pi-coding-agent";
import { TaskTool } from "@oh-my-pi/pi-coding-agent/task";
import { theme, type ThemeColor, visibleWidth } from "@oh-my-pi/pi-tui";
import type { AgentProgress, SingleResult, TaskToolDetails } from "@oh-my-pi/pi-coding-agent/task";
import { type AgentRecord, agentRecords, blockKinds, enabled, expandedNow, painters } from "./state";
import { markerOf } from "./tools";
import { fitLine } from "./fit";
import { GLYPH } from "./glyphs";
import { ASSIGNMENT, actionText, formatElapsed } from "./hub";

type Status = AgentRecord["status"];

/** One subagent row of a task block. */
interface Entry {
	id: string;
	agent: string;
	description?: string;
	status: Status;
	/** Current action of a running subagent. */
	action?: string;
	durationMs?: number;
	error?: string;
}

/** Per task block: the last task details and whether a settled (non-partial) result has arrived. */
interface TaskState {
	details?: TaskToolDetails;
	resolved: boolean;
}

const CARD_LINES = 4;
const CARD_LINES_EXPANDED = 20;
const STARTING = "Starting up";
const OUTPUT_LIMIT = 600;
const PANEL_ROWS = 4;
const STATUS_GLYPH: Record<Status, ThemeColor> = {
	pending: "dim",
	running: "warning",
	completed: "success",
	failed: "error",
	aborted: "error",
};

const states = new WeakMap<object, TaskState>();
/** Assignment text per user message; null when the message is not an assignment. */
const assignments = new WeakMap<object, string | null>();
/** Panels whose last render drew the extension's Working panel instead of the original rows. */
const panelDrawn = new WeakSet<object>();

function claim(proto: object, name: string): boolean {
	const key = Symbol.for(`my-omp-harness.cursor-feed.subagents.${name}`);
	const record: Record<symbol, unknown> = proto as Record<symbol, unknown>;
	if (record[key]) return false;
	record[key] = true;
	return true;
}

function paint(color: ThemeColor, text: string): string {
	try {
		return theme.fg(color, text);
	} catch {
		return text;
	}
}

function oneLine(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

function listOf<T>(value: unknown): T[] {
	return Array.isArray(value) ? (value as T[]) : [];
}

/** An object whose `results` is an array: the shape of a task result's details. */
function isTaskToolDetails(value: unknown): value is TaskToolDetails {
	return typeof value === "object" && value !== null && "results" in value && Array.isArray(value.results);
}

/** The task details of a task call, not of any other tool that reports a `results` array. */
function isTaskDetails(value: unknown): value is TaskToolDetails {
	return isTaskToolDetails(value) && "projectAgentsDir" in value && "totalDurationMs" in value;
}

function statusOfResult(result: SingleResult): Status {
	if (result.aborted === true) return "aborted";
	return result.exitCode === 0 ? "completed" : "failed";
}

/** Keeps the latest progress per subagent; a settled result replaces it. */
function recordAgents(details: TaskToolDetails): void {
	for (const progress of listOf<AgentProgress>(details.progress)) {
		const prior = agentRecords.get(progress.id);
		agentRecords.set(progress.id, {
			id: progress.id,
			agent: progress.agent,
			description: progress.description,
			status: progress.status,
			lastIntent: progress.lastIntent,
			currentTool: progress.currentTool,
			currentToolArgs: progress.currentToolArgs,
			task: progress.task ?? prior?.task,
			startedAt: prior?.startedAt ?? Date.now(),
			durationMs: progress.durationMs,
			tokens: progress.tokens,
			toolCount: progress.toolCount,
			requests: progress.requests,
			model: progress.resolvedModel ?? prior?.model,
			thinking: progress.resolvedThinkingLevel ?? prior?.thinking,
			output: prior?.output,
			error: prior?.error,
		});
	}
	for (const result of listOf<SingleResult>(details.results)) {
		const prior = agentRecords.get(result.id);
		agentRecords.set(result.id, {
			id: result.id,
			agent: result.agent,
			description: result.description ?? prior?.description,
			status: statusOfResult(result),
			lastIntent: result.lastIntent ?? prior?.lastIntent,
			task: result.task ?? prior?.task,
			startedAt: prior?.startedAt ?? Date.now(),
			durationMs: result.durationMs,
			tokens: result.tokens,
			toolCount: prior?.toolCount,
			requests: result.requests,
			model: result.resolvedModel ?? prior?.model,
			thinking: result.resolvedThinkingLevel ?? prior?.thinking,
			output: result.output.slice(0, OUTPUT_LIMIT),
			error: result.error ?? prior?.error,
		});
	}
}

/** Subagents named by the call args, before any progress or result exists. */
function entriesOfArgs(args: unknown): Entry[] {
	if (typeof args !== "object" || args === null) return [];
	const record = args as { name?: unknown; agent?: unknown; task?: unknown; tasks?: unknown };
	const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
	if (Array.isArray(record.tasks)) {
		return record.tasks.map((item: unknown, index: number): Entry => {
			const batch = (typeof item === "object" && item !== null ? item : {}) as { name?: unknown; agent?: unknown };
			return { id: text(batch.name) || `#${index + 1}`, agent: text(batch.agent), status: "pending" };
		});
	}
	const name = text(record.name);
	const agent = text(record.agent);
	if (!name && !agent && !text(record.task)) return [];
	return [{ id: name || "agent", agent, status: "pending" }];
}

function entriesOf(details: TaskToolDetails | undefined, resolved: boolean, args: unknown): Entry[] {
	const results = listOf<SingleResult>(details?.results);
	if (results.length > 0) {
		return results.map(
			(result): Entry => ({
				id: result.id,
				agent: result.agent,
				description: result.description,
				status: statusOfResult(result),
				durationMs: result.durationMs,
				error: result.error,
			}),
		);
	}
	const progress = listOf<AgentProgress>(details?.progress);
	if (progress.length > 0) {
		return progress.map(
			(item): Entry => ({
				id: item.id,
				agent: item.agent,
				description: item.description,
				status: item.status,
				action: actionText(item.lastIntent, item.currentTool, item.currentToolArgs),
			}),
		);
	}
	return resolved ? [] : entriesOfArgs(args);
}

/** The state word of one subagent row of a task card. */
function stateTextOf(entry: Entry): string {
	switch (entry.status) {
		case "pending":
			return "starting";
		case "running":
			return entry.action || "working";
		case "completed":
			return entry.durationMs === undefined ? "done" : `done · ${formatElapsed(entry.durationMs)}`;
		case "failed": {
			const first = (entry.error ?? "").split("\n")[0]?.trim() ?? "";
			return first ? `failed · ${first}` : "failed";
		}
		case "aborted":
			return "stopped";
	}
}

/** One subagent row of a task card; the description is cut at its end so the id and the state stay whole. */
function agentLine(entry: Entry, width: number): string {
	const color = STATUS_GLYPH[entry.status];
	const head = `  ${paint(color, GLYPH.circle)} ${oneLine(entry.id)}`;
	const state = stateTextOf(entry);
	const tail = paint("dim", state);
	const base = visibleWidth(head) + 1 + visibleWidth(state);
	if (base > width) return fitLine(`${head} ${tail}`, width);
	const description = oneLine(entry.description ?? "");
	const room = width - base - 1;
	if (!description || room < 1) return `${head} ${tail}`;
	return `${head} ${paint("dim", fitLine(description, room))} ${tail}`;
}

/** The task card header: overall state glyph, running or done counts, failures, and the total time once settled. */
function headerOf(entries: Entry[], details: TaskToolDetails | undefined): string {
	const unsettled = entries.filter(entry => entry.status === "pending" || entry.status === "running").length;
	const failed = entries.filter(entry => entry.status === "failed" || entry.status === "aborted").length;
	const overall: ThemeColor = unsettled > 0 ? "warning" : failed > 0 ? "error" : "success";
	const label =
		unsettled > 0
			? `Running ${entries.length} ${entries.length === 1 ? "agent" : "agents"}`
			: `${entries.length} ${entries.length === 1 ? "agent" : "agents"} finished`;
	let line = `${paint(overall, GLYPH.circle)} ${label}`;
	if (unsettled > 0) {
		const settled = entries.length - unsettled;
		if (settled > 0) line += paint("dim", ` · ${settled} done`);
	}
	if (unsettled === 0) {
		if (failed > 0) line += paint("error", ` · ${failed} failed`);
		if (typeof details?.totalDurationMs === "number") {
			line += paint("dim", ` · ${formatElapsed(details.totalDurationMs)}`);
		}
	}
	return line;
}

function paintTask(owner: object, width: number, args: unknown): readonly string[] | undefined {
	const state = states.get(owner);
	const entries = entriesOf(state?.details, state?.resolved === true, args);
	if (entries.length === 0) return undefined;
	return [fitLine(headerOf(entries, state?.details), width), ...entries.map(entry => agentLine(entry, width))];
}

/** Records the details of every task result (partial or settled) and claims the block as a task block. */
function noteResult(owner: object, result: unknown, partial: boolean): void {
	const details = typeof result === "object" && result !== null ? (result as { details?: unknown }).details : undefined;
	if (isTaskDetails(details)) {
		blockKinds.set(owner, "task");
		recordAgents(details);
		states.set(owner, { details, resolved: !partial });
		return;
	}
	if (blockKinds.get(owner) === "task" && !partial) {
		states.set(owner, { details: states.get(owner)?.details, resolved: true });
	}
}

function patchTaskCall(): void {
	const proto = TaskTool.prototype;
	if (!claim(proto, "task-call")) return;
	const renderCall = proto.renderCall;
	proto.renderCall = function (this: TaskTool, ...args: Parameters<TaskTool["renderCall"]>) {
		const original = () => renderCall.apply(this, args);
		try {
			const [params, options] = args;
			return markerOf("task", params, options, original);
		} catch {
			return original();
		}
	};
}

function patchToolResult(): void {
	const proto = ToolExecutionComponent.prototype;
	if (!claim(proto, "tool-result")) return;
	const updateResult = proto.updateResult;
	proto.updateResult = function (this: ToolExecutionComponent, ...args: Parameters<ToolExecutionComponent["updateResult"]>) {
		const out = updateResult.apply(this, args);
		try {
			noteResult(this, args[0], args[1] === true);
		} catch {
			// Fail safe: the block keeps its original view.
		}
		return out;
	};
}

/** The raw text of the first markdown node of a native description tree. */
function markdownOf(node: unknown, depth = 0): string | undefined {
	if (depth > 8 || typeof node !== "object" || node === null) return undefined;
	const record = node as { k?: unknown; p?: unknown; c?: unknown };
	if (record.k === "md") {
		const text = (record.p as { text?: unknown } | undefined)?.text;
		return typeof text === "string" ? text : undefined;
	}
	if (!Array.isArray(record.c)) return undefined;
	for (const child of record.c) {
		const found = markdownOf(child, depth + 1);
		if (found !== undefined) return found;
	}
	return undefined;
}

/** The assignment text of a user message without its prefix; undefined for any other message. */
function assignmentOf(owner: UserMessageComponent): string | undefined {
	const known = assignments.get(owner);
	if (known !== undefined) return known ?? undefined;
	const raw = markdownOf(owner.describe());
	const text = raw !== undefined && ASSIGNMENT.test(raw) ? raw.replace(ASSIGNMENT, "") : undefined;
	assignments.set(owner, text ?? null);
	return text;
}

function cardRows(text: string, width: number): string[] {
	const body = text
		.trim()
		.split("\n")
		.map(line => line.replace(/\t/g, "    "));
	const limit = expandedNow() ? CARD_LINES_EXPANDED : CARD_LINES;
	const shown = body.slice(0, limit);
	const rest = body.length - shown.length;
	const rows = ["Task from Main", ...shown.map(line => paint("text", `│ ${line}`))];
	if (rest > 0) rows.push(paint("dim", `… ${rest} more lines`));
	return rows.map(row => fitLine(row, width));
}

function patchUserMessage(): void {
	const proto = UserMessageComponent.prototype;
	if (!claim(proto, "user-message")) return;
	const render = proto.render;
	proto.render = function (this: UserMessageComponent, width: number): readonly string[] {
		if (enabled()) {
			try {
				const text = assignmentOf(this);
				if (text !== undefined) return cardRows(text, width);
			} catch {
				// Fail safe: the original bubble stands.
			}
		}
		return render.call(this, width);
	};
}

function isWorking(record: AgentRecord): boolean {
	return record.status === "pending" || record.status === "running";
}

function actionOf(record: AgentRecord): string {
	if (record.status === "pending") return STARTING;
	const intent = oneLine(record.lastIntent ?? "");
	if (intent) return intent;
	return record.currentTool ? oneLine(`${record.currentTool} ${record.currentToolArgs ?? ""}`) : "";
}

function panelLine(record: AgentRecord): string {
	const action = actionOf(record);
	return `  ${paint(record.status === "pending" ? "dim" : "warning", GLYPH.circle)} ${oneLine(record.id)}${action ? ` · ${paint("dim", action)}` : ""}`;
}

function patchHud(): void {
	const proto = SubagentHudComponent.prototype;
	if (!claim(proto, "hud")) return;
	const render = proto.render;
	const getClickAgentAtRow = proto.getClickAgentAtRow;
	proto.render = function (this: SubagentHudComponent, width: number): readonly string[] {
		panelDrawn.delete(this);
		if (enabled()) {
			try {
				const working = [...agentRecords.values()].filter(isWorking);
				if (working.length > 0) {
					panelDrawn.add(this);
					const label = working.length === 1 ? "1 agent working" : `${working.length} agents working`;
					const shown = working.slice(0, PANEL_ROWS);
					const rest = working.length - shown.length;
					const rows = [paint("dim", label), ...shown.map(record => panelLine(record))];
					if (rest > 0) rows.push(paint("dim", `  … ${rest} more`));
					return rows.map(row => fitLine(row, width));
				}
			} catch {
				panelDrawn.delete(this);
			}
		}
		return render.call(this, width);
	};
	proto.getClickAgentAtRow = function (this: SubagentHudComponent, row: number): string | undefined {
		return panelDrawn.has(this) ? undefined : getClickAgentAtRow.call(this, row);
	};
}

/** Installs the task painter and the subagent patches once per process; call after installCursorFeed. */
export function installSubagents(): void {
	painters.set("task", paintTask);
	patchTaskCall();
	patchToolResult();
	patchUserMessage();
	patchHud();
}
