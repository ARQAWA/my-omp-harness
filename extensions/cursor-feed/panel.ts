import { InteractiveMode } from "@oh-my-pi/pi-coding-agent";
import { theme, type ThemeColor, truncateToWidth, visibleWidth } from "@oh-my-pi/pi-tui";
import { enabled } from "./state";

/** The parts of the interactive mode that the todo panel reads. */
export type ModeLike = Pick<
	InteractiveMode,
	"todoContainer" | "todoPhases" | "todoExpanded" | "toolOutputExpanded" | "isCompactTodoMode"
>;

type Phase = ModeLike["todoPhases"][number];
type Task = Phase["tasks"][number];
type Container = ModeLike["todoContainer"];

interface ProgressSlot {
	state?: { item: string; steps: string[]; current: number };
	canShow?: (item: string) => boolean;
	sync?: () => void;
}

const GUARD = Symbol.for("my-omp-harness.cursor-feed.panel");
const PROGRESS = Symbol.for("my-omp-harness.progress");
const slot = ((globalThis as Record<symbol, unknown>)[PROGRESS] ??= {}) as ProgressSlot;

/** The interactive mode that last reported its compact mode, i.e. the one drawn in this session. */
let current: ModeLike | undefined;

function paint(color: ThemeColor, text: string): string {
	try {
		return theme.fg(color, text);
	} catch {
		return text;
	}
}

function isDone(task: Task): boolean {
	return task.status === "completed" || task.status === "abandoned";
}

/** One task row: the prefix, a status symbol and the text; the in-progress row carries the substep bar. */
function taskLine(prefix: string, task: Task, width: number): string {
	const { content, status } = task;
	if (status === "completed" || status === "abandoned") return `${prefix}${paint("success", "✓")} ${paint("dim", content)}`;
	if (status === "pending" || status === "blocked") return `${prefix}${paint("dim", "○")} ${paint("muted", content)}`;

	const state = slot.state;
	if (status === "in_progress" && state !== undefined && state.item === content && state.steps.length > 0) {
		const total = state.steps.length;
		const cur = Math.min(Math.max(1, Math.round(state.current)), total);
		const bar = state.steps.map((_step, index) => (index < cur ? "▰" : "▱")).join("");
		const barPart = `  ${paint("accent", bar)} ${paint("dim", `${cur}/${total} ${state.steps[cur - 1]}`)}`;
		const room = Math.max(1, width - visibleWidth(`${prefix}● `) - visibleWidth(barPart));
		return `${prefix}${paint("accent", "●")} ${paint("text", truncateToWidth(content, room))}${barPart}`;
	}
	return `${prefix}${paint("accent", "●")} ${paint("text", content)}`;
}

/** The panel rows: a collapsed window of one phase, or every phase when expanded. */
function panelLines(mode: ModeLike, width: number): string[] {
	const phases = mode.todoPhases.filter(phase => phase.tasks.length > 0);
	const all = phases.flatMap(phase => phase.tasks);
	if (all.length === 0) return [];
	const done = all.filter(isDone).length;
	const total = all.length;
	const expanded = mode.toolOutputExpanded === true || mode.todoExpanded === true;
	const lines: string[] = [];

	if (expanded) {
		lines.push("", ` ${paint("text", "To-dos")} ${paint("dim", `${done}/${total}`)}`);
		for (const phase of phases) {
			const phaseDone = phase.tasks.filter(isDone).length;
			lines.push(` ${paint("muted", phase.name)} ${paint("dim", `${phaseDone}/${phase.tasks.length}`)}`);
			for (const task of phase.tasks) lines.push(taskLine("   ", task, width));
		}
	} else {
		const phase: Phase =
			phases.find(item => item.tasks.some(task => task.status === "pending" || task.status === "in_progress")) ??
			phases[phases.length - 1]!;
		const tasks = phase.tasks;
		const n = tasks.length;
		const inProgress = tasks.findIndex(task => task.status === "in_progress");
		const open = tasks.findIndex(task => !isDone(task));
		const anchor = inProgress >= 0 ? inProgress : open >= 0 ? open : n - 1;
		const start = Math.max(0, Math.min(anchor - 1, n - 5));
		const windowTasks = tasks.slice(start, start + 5);
		const shown = windowTasks.length;

		lines.push("", ` ${paint("text", "To-dos")} ${paint("dim", `${done}/${total}`)} ${paint("dim", "·")} ${paint("muted", phase.name)}`);
		for (const task of windowTasks) lines.push(taskLine(" ", task, width));
		if (n - shown > 0) lines.push(` ${paint("dim", `… ещё ${n - shown}`)}`);
	}

	return lines.map(line => truncateToWidth(line, width));
}

/** Gives one todo container the panel render; the original render stays the fallback. */
function installContainer(mode: ModeLike, container: Container): void {
	const record = container as unknown as Record<symbol, unknown>;
	if (record[GUARD]) return;
	record[GUARD] = true;
	const original = container.render;
	container.render = (width: number): readonly string[] => {
		queueMicrotask(() => slot.sync?.());
		if (!enabled() || mode.isCompactTodoMode() || container.children.length === 0) return original.call(container, width);
		try {
			return panelLines(mode, width);
		} catch {
			return original.call(container, width);
		}
	};
}

/** Whether the panel draws the bar for this item: the todo panel is shown and the item is in progress. */
function canShow(item: string): boolean {
	const mode = current;
	if (!enabled() || mode === undefined) return false;
	if (mode.isCompactTodoMode() || mode.todoContainer.children.length === 0) return false;
	return mode.todoPhases.some(phase => phase.tasks.some(task => task.status === "in_progress" && task.content === item));
}

/** Draws the todo panel with cursor-feed; the progress bar of the in-progress item goes inside its row. */
export function installPanel(): void {
	const proto = InteractiveMode.prototype;
	const record = proto as unknown as Record<symbol, unknown>;
	if (record[GUARD]) return;
	record[GUARD] = true;
	slot.canShow = canShow;
	const isCompactTodoMode = proto.isCompactTodoMode;
	proto.isCompactTodoMode = function (this: InteractiveMode): boolean {
		current = this;
		if (this.todoContainer) installContainer(this, this.todoContainer);
		return isCompactTodoMode.call(this);
	};
}

/** The interactive mode whose todo panel is drawn, if one has been seen. */
export function currentMode(): ModeLike | undefined {
	return current;
}
