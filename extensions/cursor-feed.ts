import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { InteractiveMode } from "@oh-my-pi/pi-coding-agent";
import { EventController } from "@oh-my-pi/pi-coding-agent/modes/controllers/event-controller";
import { isKeyRelease, matchesKey } from "@oh-my-pi/pi-tui";
import { goalObjectives, scheduleReset, setTuiRef, type TuiRef } from "./cursor-feed/state";
import { installCursorFeed } from "./cursor-feed/tools";
import { installSubagents } from "./cursor-feed/subagents";
import { installAgentBoard } from "./cursor-feed/hub";
import { installTurn, mainAgentEnded, mainAgentStarted } from "./cursor-feed/turn";
import { installPanel } from "./cursor-feed/panel";
import { addLifecycleEvent, installDialogs } from "./cursor-feed/dialogs";

const WIDGET = "cursor-feed";

/** The Esc listener of the main session; replaced on each session start and switch. */
let unbindEscape: (() => void) | undefined;
/** The interactive mode that last focused an agent session. */
let focusMode: InteractiveMode | undefined;
/** The main TUI, whose overlay state the Esc listener reads. */
let mainTui: TuiRef | undefined;
/** The goal status last seen per goal id, in this session. */
const goalStatus = new Map<string, string>();
/** goal tool calls that are running in the main agent. */
let goalToolCalls = 0;

/** Remembers the interactive mode that focuses an agent session, so the Esc listener can reach it. */
function installFocus(): void {
	const proto = InteractiveMode.prototype;
	const record = proto as unknown as Record<symbol, unknown>;
	const key = Symbol.for("my-omp-harness.cursor-feed.focus");
	if (record[key]) return;
	record[key] = true;
	const focusAgentSession = proto.focusAgentSession;
	proto.focusAgentSession = function (this: InteractiveMode, ...args: Parameters<InteractiveMode["focusAgentSession"]>) {
		focusMode = this;
		return focusAgentSession.apply(this, args);
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

/** Esc in a focused agent view leaves the agent and opens the Agent Hub; the next Esc closes the hub. */
function bindEscape(ctx: ExtensionContext): void {
	if (ctx.mode !== "tui" || ctx.agent.kind !== "main") return;
	unbindEscape?.();
	unbindEscape = undefined;
	unbindEscape = ctx.ui.onTerminalInput(data => {
		if (isKeyRelease(data) || !matchesKey(data, "escape")) return undefined;
		const mode = focusMode;
		if (mode?.focusedAgentId === undefined || ctx.ui.getEditorText().trim() !== "" || mainTui?.hasOverlay?.() === true) {
			return undefined;
		}
		if (mode.hasActiveBtw() || mode.hasActiveOmfg() || mode.hasActiveCleanse()) return undefined;
		void mode.unfocusSession().then(() => {
			if (mode.focusedAgentId === undefined) mode.showAgentHub();
		});
		return { consume: true };
	});
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

export default function cursorFeed(pi: ExtensionAPI) {
	installFocus();
	installQueueRefresh();
	installAgentBoard();
	installCursorFeed();
    installTurn();
	installSubagents();
	installPanel();
	installDialogs();

	pi.on("session_start", (_event, ctx) => bindEscape(ctx));
	pi.on("session_switch", (_event, ctx) => bindEscape(ctx));

	pi.on("session_start", (_event, ctx) => {
		if (!ctx.hasUI || ctx.mode !== "tui" || ctx.agent.kind !== "main") return;
		// The factory runs at once and hands over the TUI; the widget is then removed so it takes no row.
		ctx.ui.setWidget(WIDGET, (tui: TuiRef) => {
			setTuiRef(tui);
			mainTui = tui;
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
	});
}
