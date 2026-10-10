import { theme, type ThemeColor, truncateToWidth, wrapTextWithAnsi } from "@oh-my-pi/pi-tui";
import type { Status } from "./rows";
import { type CallResult, goalObjectives } from "./state";

export interface TodoTask {
	content: string;
	status: string;
}

export interface TodoPhase {
	name: string;
	tasks: TodoTask[];
}

interface Question {
	question: string;
	options: string[];
}

interface Answer {
	selectedOptions: string[];
	customInput: string;
	note: string;
	timedOut: boolean;
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

/** Keeps the first four lines unless expanded, then adds a notice for the rest. */
function cut(lines: string[], expanded: boolean): string[] {
	if (expanded || lines.length <= 4) return lines;
	return [...lines.slice(0, 4), `… ещё ${lines.length - 4} строк`];
}

function fit(lines: string[], width: number): string[] {
	return lines.map(line => truncateToWidth(line, width));
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
	if (!found || !Array.isArray(found.phases)) return truncateToWidth(`${paint(DOT[status], "●")} To-do`, width);
	const phases: unknown[] = found.phases;
	const tasks = phases.flatMap(phase => {
		const list = asRecord(phase).tasks;
		return Array.isArray(list) ? list.map(item => asRecord(item)) : [];
	});
	const done = tasks.filter(task => task.status === "completed" || task.status === "abandoned").length;
	const op = found.op;
	const closed =
		op !== "view" && Array.isArray(found.completedTasks)
			? found.completedTasks.map(item => str(asRecord(item).content))
			: [];
	const current = activeTask(phases);
	const prevCurrent = activeTask(previous);
	const started =
		op !== "view" && current !== undefined && current.content !== prevCurrent?.content
			? str(current.content)
			: undefined;
	let line = `${paint(DOT[status], "●")} To-do ${paint("dim", `${done}/${tasks.length}`)}`;
	for (const content of closed) line += `  ${paint("success", "✓")} ${paint("dim", content)}`;
	if (started) line += `  ${paint("accent", "→")} ${started}`;
	return truncateToWidth(line, width);
}

/** The questions of an ask call, from its args. */
function questionsOf(args: unknown): Question[] {
	const a = asRecord(args);
	if (Array.isArray(a.questions)) {
		return a.questions.map(item => {
			const q = asRecord(item);
			return { question: str(q.question), options: optionsOf(q.options) };
		});
	}
	const question = str(a.question);
	return question ? [{ question, options: optionsOf(a.options) }] : [];
}

function optionsOf(value: unknown): string[] {
	return Array.isArray(value)
		? value.map(option => (typeof option === "string" ? option : str(asRecord(option).label)))
		: [];
}

/** Raw answers of the first usable result: one per question, or one for a single question. */
function answersOf(results: CallResult[], count: number): unknown[] {
	const hit = results.find(
		result => result.isError !== true && typeof result.details === "object" && result.details !== null,
	);
	if (!hit) return [];
	const details = asRecord(hit.details);
	const list = details.results;
	if (Array.isArray(list)) return Array.from({ length: count }, (_, index) => list[index]);
	if (Array.isArray(details.selectedOptions)) return [details];
	return [];
}

/** The answer when it counts as answered; undefined when unanswered. */
function answeredOf(value: unknown): Answer | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const a = asRecord(value);
	const answer: Answer = {
		selectedOptions: Array.isArray(a.selectedOptions) ? a.selectedOptions.map(item => str(item)) : [],
		customInput: str(a.customInput),
		note: str(a.note),
		timedOut: a.timedOut === true,
	};
	if (answer.timedOut || (answer.selectedOptions.length === 0 && !answer.customInput && !answer.note)) return undefined;
	return answer;
}

/** The ask card: questions, and their answers when the call is settled. */
export function askCardLines(
	args: unknown,
	results: CallResult[],
	status: Status,
	expanded: boolean,
	width: number,
): string[] {
	const questions = questionsOf(args);
	if (questions.length === 0) return fit([`${paint(DOT[status], "●")} ${paint("dim", "ask")}`], width);
	const answers = answersOf(results, questions.length);
	const waiting = status === "running";
	const out: string[] = [];
	questions.forEach((question, index) => {
		wrap(question.question, width - 2).forEach((line, lineIndex) => {
			out.push(
				lineIndex === 0 ? `${paint(DOT[status], "●")} ${paint("text", line)}` : `  ${paint("text", line)}`,
			);
		});
		const answer = answeredOf(answers[index]);
		if (!expanded) {
			if (waiting) return;
			if (!answer) {
				out.push(`  ${paint("dim", "— без ответа")}`);
				return;
			}
			const text = [
				...answer.selectedOptions,
				answer.customInput ? `«${answer.customInput}»` : "",
				answer.note ? `«${answer.note}»` : "",
			]
				.filter(Boolean)
				.join(", ");
			wrap(text, width - 4).forEach((line, lineIndex) => {
				out.push(lineIndex === 0 ? `  ${paint("accent", "→")} ${line}` : `    ${line}`);
			});
			return;
		}
		for (const option of question.options) {
			const chosen = answer?.selectedOptions.includes(option) === true;
			wrap(option, width - 4).forEach((line, lineIndex) => {
				if (chosen) {
					out.push(lineIndex === 0 ? `  ${paint("success", "✓")} ${line}` : `    ${line}`);
				} else {
					out.push(
						lineIndex === 0 ? `  ${paint("dim", "○")} ${paint("muted", line)}` : `    ${paint("muted", line)}`,
					);
				}
			});
		}
		if (answer?.customInput) out.push(`  ${paint("accent", "→")} «${answer.customInput}»`);
		if (answer?.note) out.push(`  ${paint("accent", "→")} «${answer.note}»`);
		if (!answer && !waiting) out.push(`  ${paint("dim", "— без ответа")}`);
	});
	return fit(out, width);
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
	const label = op === "create" ? "Goal set" : op === "complete" ? "Goal complete" : `Goal ${op || "?"}`;
	const out = [`${paint(DOT[status], "◎")} ${label}`];
	if (op === "create") {
		const section = objectiveSection(str(a.objective));
		const body = cut(
			wrap(section, width - 2).filter(line => line.trim() !== ""),
			expanded,
		);
		for (const line of body) out.push(`  ${paint("dim", line)}`);
	}
	return fit(out, width);
}

/** The card of a user message that is a guided or session goal; undefined for other text. */
export function userGoalCard(text: string, width: number, expanded: boolean): string[] | undefined {
	const t = text.trim();
	const m = /^Guided goal(?::\s*([\s\S]*))?$/.exec(t);
	let title: string;
	let body: string;
	if (m) {
		title = "Guided goal";
		body = (m[1] ?? "").trim();
	} else if (goalObjectives.has(t)) {
		title = "Goal";
		body = t;
	} else {
		return undefined;
	}
	const out = ["", `${paint("accent", "◎")} ${paint("text", title)}`];
	if (body !== "") {
		for (const line of cut(wrap(body, width - 2), expanded)) out.push(`  ${paint("dim", line)}`);
	}
	return fit(out, width);
}

/** One dialog line: the question with its answer, or without one. */
export function dialogLine(title: string, answer: string | undefined, width: number): string {
	const t = title.split("\n", 1)[0] ?? "";
	const a = (answer ?? "").split("\n", 1)[0]?.trim() ?? "";
	const line = a
		? `${paint("accent", "?")} ${t} ${paint("dim", "→")} ${a}`
		: `${paint("accent", "?")} ${t} ${paint("dim", "— без ответа")}`;
	return truncateToWidth(line, width);
}

/** One goal event line. */
export function goalEventLine(label: string, width: number): string {
	return truncateToWidth(`${paint("accent", "◎")} ${label}`, width);
}
