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
	return [...lines.slice(0, 4), `… ${lines.length - 4} more lines`];
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
	if (questions.length === 0) return fit([`${paint(DOT[status], GLYPH.circle)} ${paint("dim", "ask")}`], width);
	const answers = answersOf(results, questions.length);
	const waiting = status === "running";
	if (waiting && !expanded) {
		const count = questions.length > 1 ? ` ${paint("dim", `· ${questions.length} questions`)}` : "";
		return fit([`${paint("warning", GLYPH.circle)} ${paint("text", "Waiting for your answer")}${count}`], width);
	}
	const out: string[] = [];
	questions.forEach((question, index) => {
		const questionLines = wrap(question.question, width - 2);
		questionLines.forEach((line, lineIndex) => {
			out.push(
				lineIndex === 0 ? `${paint(DOT[status], GLYPH.circle)} ${paint("text", line)}` : `  ${paint("text", line)}`,
			);
		});
		const answer = answeredOf(answers[index]);
		if (!expanded) {
			if (!answer) {
				out.push(`  ${paint("dim", "— no answer")}`);
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
				out.push(lineIndex === 0 ? `  ${paint("dim", "→")} ${line}` : `    ${line}`);
			});
			return;
		}
		for (const option of question.options) {
			const chosen = answer?.selectedOptions.includes(option) === true;
			wrap(option, width - 4).forEach((line, lineIndex) => {
				if (chosen) {
					out.push(lineIndex === 0 ? `  ${paint("success", GLYPH.circle)} ${line}` : `    ${line}`);
				} else {
					out.push(
						lineIndex === 0 ? `  ${paint("dim", GLYPH.circle)} ${paint("muted", line)}` : `    ${paint("muted", line)}`,
					);
				}
			});
		}
		if (answer?.customInput) out.push(`  ${paint("dim", "→")} «${answer.customInput}»`);
		if (answer?.note) out.push(`  ${paint("dim", "→")} «${answer.note}»`);
		if (!answer && !waiting) out.push(`  ${paint("dim", "— no answer")}`);
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
	const label =
		op === "create" ? "Goal set"
		: op === "complete" ? "Goal complete"
		: op === "get" ? "Goal checked"
		: op === "resume" ? "Goal resumed"
		: op === "drop" ? "Goal dropped"
		: `Goal ${op || "?"}`;
	const out = [`${paint(DOT[status], GLYPH.circle)} ${label}`];
	if (op === "create") {
		const section = objectiveSection(str(a.objective));
		const body = cut(
			wrap(section, width - 2).filter(line => line.trim() !== ""),
			expanded,
		);
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
