import { theme, type ThemeColor, wrapTextWithAnsi } from "@oh-my-pi/pi-tui";
import type { Status } from "./rows";
import { fitLine } from "./fit";
import { GLYPH } from "./glyphs";
import { type CallResult, goalObjectives } from "./state";

export interface TodoTask {
	content: string;
	status: string;
}

export interface TodoPhase {
	name: string;
	tasks: TodoTask[];
}

const DOT: Record<Status, ThemeColor> = { running: "warning", error: "error", done: "success" };

function paint(color: ThemeColor, text: string): string {
	try {
		return theme.fg(color, text);
	} catch {
		return text;
	}
}

function asRecord(value: unknown): Record<string, unknown> {
	if (typeof value !== "object" || value === null) return {};
	return Object.fromEntries(Object.entries(value));
}

function str(value: unknown): string {
	return typeof value === "string" ? value : "";
}

/** Wraps each source line; blank lines stay blank. */
function wrap(text: string, width: number): string[] {
	return text.split("\n").flatMap(line => (line === "" ? [""] : wrapTextWithAnsi(line, Math.max(10, width))));
}

function fit(lines: string[], width: number): string[] {
	return lines.map(line => fitLine(line, width));
}

/** The first task in progress, across phases. */
function activeTask(phases: unknown[] | undefined): Record<string, unknown> | undefined {
	for (const phase of phases ?? []) {
		const list = asRecord(phase).tasks;
		if (!Array.isArray(list)) continue;
		const task = list.map(item => asRecord(item)).find(item => item.status === "in_progress");
		if (task) return task;
	}
	return undefined;
}

/** The to-do row: progress count, closed tasks and the task just started. */
export function todoRowLine(
	args: unknown,
	results: CallResult[],
	previous: TodoPhase[] | undefined,
	status: Status,
	width: number,
): string {
	const found = results.map(result => asRecord(result.details)).find(record => Array.isArray(record.phases));
	if (!found || !Array.isArray(found.phases)) return fitLine(`${paint(DOT[status], GLYPH.circle)} To-do`, width);
	const phases: unknown[] = found.phases;
	const tasks = phases.flatMap(phase => {
		const list = asRecord(phase).tasks;
		return Array.isArray(list) ? list.map(item => asRecord(item)) : [];
	});
	const done = tasks.filter(task => task.status === "completed" || task.status === "abandoned").length;
	const closed =
		Array.isArray(found.completedTasks)
			? found.completedTasks.map(item => str(asRecord(item).content))
			: [];
	const current = activeTask(phases);
	const prevCurrent = activeTask(previous);
	const started =
		current !== undefined && current.content !== prevCurrent?.content
			? str(current.content)
			: undefined;
	let line = `${paint(DOT[status], GLYPH.circle)} To-do ${paint("dim", `${done}/${tasks.length}`)}`;
	for (const content of closed) line += `  ${paint("success", GLYPH.circle)} ${paint("dim", content)}`;
	if (started) line += `  ${paint("warning", GLYPH.circle)} ${started}`;
	return fitLine(line, width);
}

/** The objective of a goal call: the "## Objective" section, else the whole objective. */
function objectiveSection(objective: string): string {
	const lines = objective.split("\n");
	const start = lines.findIndex(line => /^##\s+Objective\s*$/.test(line));
	if (start < 0) return objective.trim();
	const body: string[] = [];
	for (const line of lines.slice(start + 1)) {
		if (line.startsWith("## ")) break;
		body.push(line);
	}
	return body.join("\n").trim();
}

/** The header label of a goal op. */
export function goalLabel(op: string): string {
	return (
		op === "create" ? "Goal set"
		: op === "complete" ? "Goal complete"
		: op === "get" ? "Goal checked"
		: op === "resume" ? "Goal resumed"
		: op === "drop" ? "Goal dropped"
		: `Goal ${op || "?"}`
	);
}

/** The goal card: a header, and for create the objective body. */
export function goalToolLines(
	args: unknown,
	results: CallResult[],
	status: Status,
	expanded: boolean,
	width: number,
): string[] {
	const a = asRecord(args);
	const op = str(a.op);
	const out = [`${paint(DOT[status], GLYPH.circle)} ${goalLabel(op)}`];
	if (op === "create") {
		const section = objectiveSection(str(a.objective));
		const body = wrap(section, width - 2).filter(line => line.trim() !== "");
		for (const line of body) out.push(`  ${paint("text", line)}`);
	}
	return fit(out, width);
}

/** The card of a user message that is a /define-goal start or session goal; undefined for other text. */
export function userGoalCard(text: string, width: number, _expanded: boolean): string[] | undefined {
	const t = text.trim();
	const m = /^Define goal(?::\s*([\s\S]*))?$/.exec(t);
	let title: string;
	let body: string;
	if (m) {
		title = "Define goal";
		body = (m[1] ?? "").trim();
	} else if (goalObjectives.has(t)) {
		title = "Goal";
		body = t;
	} else {
		return undefined;
	}
	const out = ["", paint("text", title)];
	if (body !== "") {
		for (const line of wrap(body, width - 2)) out.push(`  ${paint("text", line)}`);
	}
	return fit(out, width);
}

/** One dialog line: the question with its answer, or without one. */
export function dialogLine(title: string, answer: string | undefined, width: number): string {
	const t = title.split("\n", 1)[0] ?? "";
	const a = (answer ?? "").split("\n", 1)[0]?.trim() ?? "";
	const line = a
		? `${paint("success", GLYPH.circle)} ${t} ${paint("dim", "→")} ${a}`
		: `${paint("dim", GLYPH.circle)} ${t} ${paint("dim", "— no answer")}`;
	return fitLine(line, width);
}

/** One goal event line; the circle is warning for paused, error for dropped, else success. */
export function goalEventLine(label: string, width: number): string {
	const color: ThemeColor = label.endsWith("paused") ? "warning" : label.endsWith("dropped") ? "error" : "success";
	return fitLine(`${paint(color, GLYPH.circle)} ${label}`, width);
}
