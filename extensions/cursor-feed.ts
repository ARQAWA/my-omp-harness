import { execFileSync } from "node:child_process";
import { basename } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { InteractiveMode } from "@oh-my-pi/pi-coding-agent";
import { EventController } from "@oh-my-pi/pi-coding-agent/modes/controllers/event-controller";
import { AgentRegistry } from "@oh-my-pi/pi-coding-agent/registry/agent-registry";
import { isKeyRelease, matchesKey, theme } from "@oh-my-pi/pi-tui";
import { enabled, goalObjectives, scheduleReset, setTuiRef, shared, type TuiRef } from "./cursor-feed/state";
import { installCursorFeed } from "./cursor-feed/tools";
import { installSubagents } from "./cursor-feed/subagents";
import { installAgentBoard, isAgentBoardOpen } from "./cursor-feed/hub";
import { installTurn, mainAgentEnded, mainAgentStarted } from "./cursor-feed/turn";
import { installPanel } from "./cursor-feed/panel";
import { addLifecycleEvent, installDialogs } from "./cursor-feed/dialogs";

const WIDGET = "cursor-feed";
/** The hint shown in the empty input of a subagent view. */
const VIEW_HINT = "Subagent view · esc main · ←← agents";
/** A double tap is two presses no further apart than this, in milliseconds. */
const CHORD_MAX_MS = 500;
/** The shortest gap between two left arrows of a double tap, in milliseconds. */
const LEFT_TAP_MIN_MS = 40;
/** The main editor draft kept while a subagent view is open, by mode. */
const savedDrafts = new WeakMap<InteractiveMode, string>();
/** The last key press of a double-tap chord: its key, the focused agent and the time. */
interface Chord {
	key: string;
	id: string | undefined;
	at: number;
}
/** The goal status last seen per goal id, in this session. */
const goalStatus = new Map<string, string>();
/** goal tool calls that are running in the main agent. */
let goalToolCalls = 0;

/** The main interactive mode, for readers of its subagent view (focusedAgentId is authoritative). */
export function viewMode(): InteractiveMode | undefined {
	return shared.mainMode as InteractiveMode | undefined;
}

const VIEW_GUARD = Symbol.for("my-omp-harness.cursor-feed.view");

/** Whether a subagent view is open in this mode and the harness is on. */
function viewOpen(mode: InteractiveMode): boolean {
	return mode.focusedAgentId !== undefined && enabled();
}

/** Whether the read-only subagent view takes the keys: no overlay is open and no collab guest link is set. */
function viewTakesKeys(mode: InteractiveMode): boolean {
	return viewOpen(mode) && mode.collabGuest === undefined && !mode.ui.hasOverlay();
}

/** Clears the main draft when a subagent view opens and restores it when the view closes; runs before every paint of the editor. */
function syncView(mode: InteractiveMode): void {
	const editor = mode.editor;
	const saved = savedDrafts.get(mode);
	if (viewOpen(mode) && saved === undefined) {
		savedDrafts.set(mode, editor.getText());
		editor.setText("");
	} else if (!viewOpen(mode) && saved !== undefined) {
		savedDrafts.delete(mode);
		editor.setText(saved);
	}
}

/** Wraps the editor of this mode: the view sync before each render and describe, and the hint while a subagent view is open. */
function installEditorView(mode: InteractiveMode): void {
	const editor = mode.editor;
	const record = editor as unknown as Record<symbol, unknown>;
	if (record[VIEW_GUARD]) return;
	record[VIEW_GUARD] = true;
	const render = editor.render;
	editor.render = (width: number) => {
		syncView(mode);
		return render.call(editor, width);
	};
	const describe = editor.describe;
	editor.describe = (...args: Parameters<typeof editor.describe>) => {
		syncView(mode);
		return describe.apply(editor, args);
	};
	const placeholder = editor.placeholder;
	editor.placeholder = () => (mode.focusedAgentId !== undefined ? theme.fg("dim", VIEW_HINT) : placeholder?.());
	const describePlaceholder = editor.describePlaceholder;
	if (describePlaceholder !== undefined) {
		editor.describePlaceholder = () => (mode.focusedAgentId !== undefined ? VIEW_HINT : describePlaceholder());
	}
}

/** SGR mouse report: the button code, then the coordinates. */
const SGR_MOUSE = /^\x1b\[<(\d+);\d+;\d+[Mm]$/;
/** Terminal replies: DA and mode reports, cursor position, cell size, OSC, DCS and APC replies. */
const TERMINAL_REPLY = /^(?:\x1b\[\?|\x1b\[\d+;\d+R$|\x1b\[6;\d+;\d+t$|\x1b[\]P_])/;

/** Mouse wheel and pointer motion, and terminal replies, reach the TUI even in the subagent view. */
function passesThrough(data: string): boolean {
	if (TERMINAL_REPLY.test(data)) return true;
	const mouse = SGR_MOUSE.exec(data);
	return mouse !== null && (Number(mouse[1]) & 96) !== 0;
}

/** Aborts the run of the agent with this id; a missing or finished agent is left alone. */
function abortAgent(id: string | undefined): void {
	if (id === undefined) return;
	const session = AgentRegistry.global().get(id)?.session;
	if (!session) return;
	try {
		void Promise.resolve(session.abort()).catch(() => undefined);
	} catch {
		// The agent keeps running; the view shows its state either way.
	}
}

/** Key listener of the subagent view: Esc returns to main, a double ←← opens the hub, a double alt+x stops the focused agent. */
function installViewKeys(mode: InteractiveMode): void {
	const record = mode as unknown as Record<symbol, unknown>;
	if (record[VIEW_GUARD]) return;
	record[VIEW_GUARD] = true;
	let chord: Chord | undefined;
	/** Starts a chord, or completes it when the same key comes again on the same agent in time; a completed chord is forgotten. */
	const tap = (key: string, minGap: number): boolean => {
		const id = mode.focusedAgentId;
		const now = Date.now();
		const prev = chord;
		chord = { key, id, at: now };
		if (!prev || prev.key !== key || prev.id !== id) return false;
		const gap = now - prev.at;
		if (gap < minGap || gap > CHORD_MAX_MS) return false;
		chord = undefined;
		return true;
	};
	mode.ui.addInputListener(data => {
		if (enabled() && isAgentBoardOpen() && matchesKey(data, "left")) return { consume: true };
		if (!viewTakesKeys(mode) || passesThrough(data)) return undefined;
		if (isKeyRelease(data)) return { consume: true };
		if (matchesKey(data, "escape")) {
			chord = undefined;
			void mode.unfocusSession().then(() => syncView(mode));
			return { consume: true };
		}
		if (matchesKey(data, "left")) {
			if (tap("left", LEFT_TAP_MIN_MS)) mode.showAgentHub();
			return { consume: true };
		}
		if (matchesKey(data, "alt+x")) {
			const id = mode.focusedAgentId;
			if (tap("alt+x", 0)) abortAgent(id);
			return { consume: true };
		}
		chord = undefined;
		return { consume: true };
	});
}

/** Wires one main mode: its key listener and its editor callbacks. Each part is installed once. */
function installView(mode: InteractiveMode): void {
	installViewKeys(mode);
	installEditorView(mode);
}

/** Captures the main interactive mode at its init, wires its subagent view, and syncs the view after each focus change. */
function installFocus(): void {
	const proto = InteractiveMode.prototype;
	const record = proto as unknown as Record<symbol, unknown>;
	const key = Symbol.for("my-omp-harness.cursor-feed.focus");
	if (record[key]) return;
	record[key] = true;
	const init = proto.init;
	proto.init = function (this: InteractiveMode, ...args: Parameters<InteractiveMode["init"]>): ReturnType<InteractiveMode["init"]> {
		shared.mainMode = this;
		installView(this);
		return init.apply(this, args);
	};
	const focusAgentSession = proto.focusAgentSession;
	proto.focusAgentSession = function (this: InteractiveMode, ...args: Parameters<InteractiveMode["focusAgentSession"]>) {
		installView(this);
		return focusAgentSession.apply(this, args).then(() => syncView(this));
	};
}

/** Refreshes the queued-message band of the last interactive mode when the agent queue changes. */
function installQueueRefresh(): void {
	const modeProto = InteractiveMode.prototype;
	const record = modeProto as unknown as Record<symbol, unknown>;
	const key = Symbol.for("my-omp-harness.cursor-feed.queue-refresh");
	if (record[key]) return;
	record[key] = true;
	let queueMode: InteractiveMode | undefined;
	const updatePendingMessagesDisplay = modeProto.updatePendingMessagesDisplay;
	modeProto.updatePendingMessagesDisplay = function (
		this: InteractiveMode,
		...args: Parameters<InteractiveMode["updatePendingMessagesDisplay"]>
	): ReturnType<InteractiveMode["updatePendingMessagesDisplay"]> {
		queueMode = this;
		return updatePendingMessagesDisplay.apply(this, args);
	};
	const init = modeProto.init;
	modeProto.init = function (this: InteractiveMode, ...args: Parameters<InteractiveMode["init"]>): ReturnType<InteractiveMode["init"]> {
		queueMode = this;
		return init.apply(this, args);
	};
	const eventProto = EventController.prototype;
	const handleEvent = eventProto.handleEvent;
	eventProto.handleEvent = async function (
		this: EventController,
		...args: Parameters<EventController["handleEvent"]>
	): Promise<void> {
		await handleEvent.apply(this, args);
		if (args[0].type === "queue_update") queueMode?.updatePendingMessagesDisplay();
	};
}

/** Rebuilds the goal objectives and statuses of the session from its entries. */
function seedObjectives(ctx: ExtensionContext): void {
	if (!ctx.hasUI || ctx.mode !== "tui" || ctx.agent.kind !== "main") return;
	goalObjectives.clear();
	goalStatus.clear();
	try {
		const entries = ctx.sessionManager.getEntries() as unknown as Array<{
			type?: string;
			data?: { goal?: { id: string; objective?: unknown; status: string } };
		}>;
		for (const entry of entries) {
			if (entry.type !== "mode_change") continue;
			const goal = entry.data?.goal;
			if (typeof goal?.objective !== "string") continue;
			goalObjectives.add(goal.objective.trim());
			goalStatus.set(goal.id, goal.status);
		}
	} catch {
		// Fail safe: the feed keeps no goal state for this session.
	}
	scheduleReset();
}

let lastNudgeAt = 0;

/** herdr repaints its host surface only on resize; a bare SIGWINCH triggers the same full repaint without a size change. */
function nudgeHerdr(ctx: ExtensionContext): void {
	if (process.env.HERDR_ENV !== "1" || process.platform === "win32") return;
	const now = Date.now();
	if (now - lastNudgeAt < 5000) return;
	lastNudgeAt = now;
	setTimeout(() => {
		try {
			const text = ctx.ui.getEditorText?.();
			if (typeof text === "string" && text.trim() !== "") return;
			for (const pid of herdrClientPids()) {
				try {
					process.kill(pid, "SIGWINCH");
				} catch {}
			}
		} catch {}
	}, 400);
}

function herdrClientPids(): number[] {
	const out = execFileSync("ps", ["-axo", "pid=,tty=,command="], { encoding: "utf8" });
	const pids: number[] = [];
	for (const line of out.split("\n")) {
		const match = /^\s*(\d+)\s+(\S+)\s+(.*)$/.exec(line);
		if (!match) continue;
		const [, pid = "", tty = "", command = ""] = match;
		if (tty === "??" || tty === "?") continue;
		const [first = "", ...args] = command.trim().split(/\s+/);
		if (basename(first) !== "herdr" || args.includes("server")) continue;
		pids.push(Number(pid));
	}
	return pids;
}

export default function cursorFeed(pi: ExtensionAPI) {
	installFocus();
	installQueueRefresh();
	installAgentBoard();
	installCursorFeed();
    installTurn();
	installSubagents();
	installPanel();
	installDialogs();

	pi.on("session_start", (_event, ctx) => {
		if (!ctx.hasUI || ctx.mode !== "tui" || ctx.agent.kind !== "main") return;
		// The factory runs at once and hands over the TUI; the widget is then removed so it takes no row.
		ctx.ui.setWidget(WIDGET, (tui: TuiRef) => {
			setTuiRef(tui);
			return { render: () => [], invalidate() {} };
		});
		ctx.ui.setWidget(WIDGET, undefined);
	});

	pi.on("session_start", (_event, ctx) => seedObjectives(ctx));
	pi.on("session_switch", (_event, ctx) => seedObjectives(ctx));

	pi.on("tool_call", (event, ctx) => {
		if (ctx.agent.kind !== "main" || event.toolName !== "goal") return;
		goalToolCalls++;
	});
	pi.on("tool_result", (event, ctx) => {
		if (ctx.agent.kind !== "main" || event.toolName !== "goal") return;
		goalToolCalls = Math.max(0, goalToolCalls - 1);
	});

	pi.on("goal_updated", (event, ctx) => {
		if (ctx.mode !== "tui" || ctx.agent.kind !== "main") return;
		const goal = event.goal;
		if (!goal) return;
		if (typeof goal.objective === "string") goalObjectives.add(goal.objective.trim());
		const prev = goalStatus.get(goal.id);
		goalStatus.set(goal.id, goal.status);
		if (goalToolCalls > 0) return;
		if ((prev === "active" || prev === "budget-limited") && goal.status === "paused") addLifecycleEvent("paused");
		if (prev === "paused" && goal.status === "active") addLifecycleEvent("resumed");
		if (goal.status === "dropped" && prev !== "dropped") addLifecycleEvent("dropped");
	});

	pi.on("agent_start", (_event, ctx) => {
		if (ctx.mode !== "tui" || ctx.agent.kind !== "main") return;
		mainAgentStarted();
	});

	pi.on("agent_end", (event, ctx) => {
		if (ctx.mode !== "tui" || ctx.agent.kind !== "main") return;
		// A run that continues is not an end: the turn stays open.
		if (event.willContinue) return;
		mainAgentEnded();
		scheduleReset();
		nudgeHerdr(ctx);
	});
}
