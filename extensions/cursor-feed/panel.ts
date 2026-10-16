import { InteractiveMode } from "@oh-my-pi/pi-coding-agent";
import { theme, type ThemeColor } from "@oh-my-pi/pi-tui";
import { enabled } from "./state";
import { fitLine } from "./fit";
import { GLYPH } from "./glyphs";

/** The parts of the interactive mode that the todo panel reads. */
export type ModeLike = Pick<
	InteractiveMode,
	"todoContainer" | "todoPhases" | "todoExpanded" | "toolOutputExpanded" | "session" | "viewSession" | "setTodos"
>;

type Phase = ModeLike["todoPhases"][number];
type Task = Phase["tasks"][number];
type Container = ModeLike["todoContainer"];
type Progress = { cur: number; total: number; steps: string[] };

interface ProgressSlot {
	state?: { item: string; steps: string[]; current: number };
	phases?: Phase[];
	setTodos?: (phases: Phase[]) => void;
	/** The interactive mode of this session, captured when its init starts; its todo panel is drawn. */
	mode?: ModeLike;
}

const GUARD = Symbol.for("my-omp-harness.cursor-feed.panel");
const PROGRESS = Symbol.for("my-omp-harness.progress");
const slot = ((globalThis as Record<symbol, unknown>)[PROGRESS] ??= {}) as ProgressSlot;

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

const BAR_EMPTY = ["\u{EE00}", "\u{EE01}", "\u{EE02}"] as const;
const BAR_FILLED = ["\u{EE03}", "\u{EE04}", "\u{EE05}"] as const;

/** The 8-cell substep bar: cell 0 is a left end, cell 7 a right end, the rest middles; cells below `filled` are filled. */
export function bar(cur: number, total: number): { glyph: string; filled: boolean }[] {
	const filled = Math.round((8 * cur) / total);
	return Array.from({ length: 8 }, (_cell, index) => {
		const end = index === 0 ? 0 : index === 7 ? 2 : 1;
		const on = index < filled;
		return { glyph: (on ? BAR_FILLED : BAR_EMPTY)[end]!, filled: on };
	});
}

/** One task row: the prefix, a status symbol and the text. */
function taskLine(prefix: string, task: Task): string {
	const { content, status } = task;
	if (status === "completed" || status === "abandoned") return `${prefix}${paint("success", GLYPH.circle)} ${paint("dim", content)}`;
	if (status === "pending" || status === "blocked") return `${prefix}${paint("dim", GLYPH.circle)} ${paint("muted", content)}`;
	return `${prefix}${paint("warning", GLYPH.circle)} ${paint("text", content)}`;
}

/** The progress of the in-progress item that the slot describes, or undefined for any other task. */
function progressOf(task: Task): Progress | undefined {
	const state = slot.state;
	if (task.status !== "in_progress" || state === undefined || state.item !== task.content || state.steps.length === 0) return undefined;
	const total = state.steps.length;
	const cur = Math.min(Math.max(1, Math.round(state.current)), total);
	return { cur, total, steps: state.steps };
}

/** The row under the current item in the collapsed panel: the substep bar and the current step. */
function barLine(progress: Progress): string {
	const cells = bar(progress.cur, progress.total).map(cell => paint(cell.filled ? "warning" : "dim", cell.glyph)).join("");
	return `    ${cells} ${paint("dim", `${progress.cur}/${progress.total} ${progress.steps[progress.cur - 1]}`)}`;
}

/** The rows under the current item in the expanded panel: earlier steps done, the current one in progress, later ones pending. */
function stepLines(progress: Progress): string[] {
	return progress.steps.map((step, index) => {
		const n = index + 1;
		if (n < progress.cur) return `      ${paint("success", GLYPH.circle)} ${paint("dim", step)}`;
		if (n === progress.cur) return `      ${paint("warning", GLYPH.circle)} ${paint("text", step)}`;
		return `      ${paint("dim", GLYPH.circle)} ${paint("muted", step)}`;
	});
}

/** The panel rows: up to four tasks around the current one, or every phase when expanded. */
function panelLines(mode: ModeLike | undefined, phases: Phase[], width: number): string[] {
	const nonEmpty = phases.filter(phase => phase.tasks.length > 0);
	const all = nonEmpty.flatMap(phase => phase.tasks);
	const left = all.filter(task => !isDone(task)).length;
	if (left === 0) return [];
	const expanded = mode?.toolOutputExpanded === true || mode?.todoExpanded === true;
	const lines: string[] = [];

	if (expanded) {
		for (const phase of nonEmpty) {
			const phaseDone = phase.tasks.filter(isDone).length;
			lines.push(`  ${paint("muted", phase.name)} ${paint("dim", `${phaseDone}/${phase.tasks.length}`)}`);
			for (const task of phase.tasks) {
				lines.push(taskLine("    ", task));
				const progress = progressOf(task);
				if (progress) lines.push(...stepLines(progress));
			}
		}
	} else {
		const n = all.length;
		const inProgress = all.findIndex(task => task.status === "in_progress");
		const open = all.findIndex(task => !isDone(task));
		const anchor = inProgress >= 0 ? inProgress : open >= 0 ? open : n - 1;
		const start = Math.max(0, Math.min(anchor - 1, n - 4));
		for (const task of all.slice(start, start + 4)) {
			lines.push(taskLine("  ", task));
			const progress = progressOf(task);
			if (progress) lines.push(barLine(progress));
		}
	}

	return lines.map(line => fitLine(line, width));
}

/** Empties the native todo container while the panel is on, so the todo list is drawn once; the original render stays when the panel is off. */
function installContainer(container: Container): void {
	const record = container as unknown as Record<symbol, unknown>;
	if (record[GUARD]) return;
	record[GUARD] = true;
	const original = container.render;
	container.render = (width: number): readonly string[] => (enabled() ? [] : original.call(container, width));
}

/** The todo panel rows for the status bar title widget; empty when the panel is off or no phases were published. */
export function todoPanelLines(width: number): string[] {
	const phases = slot.phases;
	if (!enabled() || phases === undefined) return [];
	try {
		return panelLines(slot.mode, phases, width);
	} catch {
		return [];
	}
}

/** True when the published todo plan has a task with status blocked. */
export function hasBlockedItem(): boolean {
	return (slot.phases ?? []).some(phase => phase.tasks.some(task => task.status === "blocked"));
}

/** Captures the interactive mode when its init starts and empties its native todo container while the panel is on. */
export function installPanel(): void {
	const proto = InteractiveMode.prototype;
	const record = proto as unknown as Record<symbol, unknown>;
	if (record[GUARD]) return;
	record[GUARD] = true;
	slot.setTodos = phases => {
		slot.phases = phases;
		const mode = slot.mode;
		if (mode !== undefined) {
			mode.session.setTodoPhases(phases);
			if (mode.viewSession === mode.session) mode.setTodos(phases);
		}
	};
	const init = proto.init;
	proto.init = function (this: InteractiveMode, ...args: Parameters<InteractiveMode["init"]>): Promise<void> {
		slot.mode = this;
		if (this.todoContainer) installContainer(this.todoContainer);
		return init.apply(this, args);
	};
}

/** The interactive mode whose todo panel is drawn, if one has been seen. */
export function currentMode(): ModeLike | undefined {
	return slot.mode;
}
