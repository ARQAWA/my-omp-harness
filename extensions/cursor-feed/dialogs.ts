import {
	AssistantMessageComponent,
	InteractiveMode,
	ToolExecutionComponent,
	UserMessageComponent,
} from "@oh-my-pi/pi-coding-agent";
import { type Component, truncateToWidth } from "@oh-my-pi/pi-tui";
import { dialogLine, goalEventLine } from "./cards";
import { enabled, pinnedRows } from "./state";
import { currentMode } from "./panel";

/** The loose view of the interactive mode that a feed row needs. */
interface Mode {
	present?(component: Component): void;
	chatContainer?: { addChild(child: Component): void; children?: Component[] };
	ui?: { requestRender(): void };
}

/** A transcript row whose lines are built at render time from the terminal width. */
class FeedRow implements Component {
	readonly #lines: (width: number) => string[];

	constructor(lines: (width: number) => string[]) {
		this.#lines = lines;
	}

	render(width: number): string[] {
		try {
			return this.#lines(width).map(line => truncateToWidth(line, width));
		} catch {
			return [];
		}
	}

	invalidate(): void {}
}

/** Dialog titles of the goal menu: "Goal: <objective> (<status>)" or "Goal paused: <objective>". */
const GOAL_TITLE = /^Goal(?: paused)?: /;
/** Goal status lines that the feed shows as its own rows instead. */
const GOAL_STATUS: Record<string, true> = { "Goal mode paused.": true, "Goal mode resumed.": true, "Goal dropped.": true };

/** Adds a row to the chat transcript of the mode, when the feed is enabled. */
function addRow(mode: Mode | undefined, lines: (width: number) => string[]): void {
	if (!mode || !enabled()) return;
	try {
		const row = new FeedRow(lines);
		pinnedRows.add(row);
		if (typeof mode.present === "function") {
			mode.present(row);
		} else {
			mode.chatContainer?.addChild(row);
			mode.ui?.requestRender();
		}
	} catch {
		// Fail safe: the dialog still returns its answer.
	}
}

/** A feed row taken out of the transcript, with the number of message components before it. */
interface SavedRow {
	row: FeedRow;
	anchor: number;
}

/** Whether a transcript child is a message component that counts toward a row's anchor. */
function isMessage(child: unknown): boolean {
	return (
		child instanceof UserMessageComponent ||
		child instanceof AssistantMessageComponent ||
		child instanceof ToolExecutionComponent
	);
}

/** Saves each feed row of the transcript with the number of message components before it. */
function savedRows(children: Component[]): SavedRow[] {
	const saved: SavedRow[] = [];
	let messages = 0;
	for (const child of children) {
		if (child instanceof FeedRow) saved.push({ row: child, anchor: messages });
		else if (isMessage(child)) messages++;
	}
	return saved;
}

/** Puts each saved row back right before the message component at its anchor, or at the end. */
function restoreRows(children: Component[], saved: SavedRow[]): void {
	for (const { row, anchor } of saved) {
		let messages = 0;
		let index = children.length;
		for (let i = 0; i < children.length; i++) {
			if (!isMessage(children[i])) continue;
			if (messages === anchor) {
				index = i;
				break;
			}
			messages++;
		}
		children.splice(index, 0, row);
	}
}

/** Patches the dialogs of the interactive mode once; each wrapper returns what the original returns. */
export function installDialogs(): void {
	(globalThis as Record<symbol, unknown>)[Symbol.for("my-omp-harness.cursor-feed.dialog")] = (
		title: string,
		answer: string | undefined,
	) => addRow(currentMode(), w => [dialogLine(title, answer, w)]);

	const proto = InteractiveMode.prototype;
	const record = proto as unknown as Record<symbol, unknown>;
	const key = Symbol.for("my-omp-harness.cursor-feed.dialogs");
	if (record[key]) return;
	record[key] = true;

	const rebuildChatFromMessages = proto.rebuildChatFromMessages;
	if (typeof rebuildChatFromMessages === "function") {
		proto.rebuildChatFromMessages = function (
			this: InteractiveMode,
			...args: Parameters<InteractiveMode["rebuildChatFromMessages"]>
		) {
			const mode = this as unknown as Mode;
			let saved: SavedRow[] = [];
			try {
				const children = mode.chatContainer?.children;
				if (enabled() && children) saved = savedRows(children);
			} catch {
				saved = [];
			}
			const result = rebuildChatFromMessages.apply(this, args);
			if (saved.length > 0) {
				try {
					const children = mode.chatContainer?.children;
					if (children) restoreRows(children, saved);
					this.ui?.requestRender();
				} catch {
					// Fail safe: the rebuild result stays.
				}
			}
			return result;
		};
	}

	const showHookSelector = proto.showHookSelector;
	proto.showHookSelector = async function (this: InteractiveMode, ...args: Parameters<InteractiveMode["showHookSelector"]>) {
		const choice = await showHookSelector.apply(this, args);
		const title = args[0];
		if (enabled() && typeof title === "string" && GOAL_TITLE.test(title)) {
			addRow(this as unknown as Mode, w => [dialogLine(title, choice, w)]);
		}
		return choice;
	};

	const showHookConfirm = proto.showHookConfirm;
	proto.showHookConfirm = async function (this: InteractiveMode, ...args: Parameters<InteractiveMode["showHookConfirm"]>) {
		const [title, message, opts] = args;
		if (!enabled() || title !== "Drop goal?") return showHookConfirm.apply(this, args);
		const choice = await this.showHookSelector(`${title}\n${message}`, ["Yes", "No"], opts);
		addRow(this as unknown as Mode, w => [dialogLine(title, choice, w)]);
		return choice === "Yes";
	};

	const showHookEditor = proto.showHookEditor;
	proto.showHookEditor = async function (this: InteractiveMode, ...args: Parameters<InteractiveMode["showHookEditor"]>) {
		const text = await showHookEditor.apply(this, args);
		const title = args[0];
		if (enabled() && title === "Goal objective") {
			addRow(this as unknown as Mode, w => [dialogLine(title, text?.trim() || undefined, w)]);
		}
		return text;
	};

	const showPlanReview = proto.showPlanReview;
	proto.showPlanReview = async function (this: InteractiveMode, ...args: Parameters<InteractiveMode["showPlanReview"]>) {
		const choice = await showPlanReview.apply(this, args);
		const title = args[1];
		if (enabled() && title === "Plan mode - next step") {
			addRow(this as unknown as Mode, w => [dialogLine(title, choice, w)]);
		}
		return choice;
	};

	const showStatus = proto.showStatus;
	proto.showStatus = function (this: InteractiveMode, ...args: Parameters<InteractiveMode["showStatus"]>) {
		const text = args[0];
		if (enabled() && typeof text === "string" && GOAL_STATUS[text] === true) return;
		return showStatus.apply(this, args);
	};
}

/** Adds a goal lifecycle row to the chat: paused, resumed or dropped. */
export function addLifecycleEvent(kind: "paused" | "resumed" | "dropped"): void {
	addRow(currentMode(), w => [goalEventLine(`Goal ${kind}`, w)]);
}
