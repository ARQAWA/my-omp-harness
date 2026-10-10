import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { InteractiveMode } from "@oh-my-pi/pi-coding-agent";
import { isKeyRelease, matchesKey } from "@oh-my-pi/pi-tui";
import { scheduleReset, setTuiRef, type TuiRef } from "./cursor-feed/state";
import { installCursorFeed } from "./cursor-feed/tools";
import { installSubagents } from "./cursor-feed/subagents";
import { installTurn, mainAgentEnded, mainAgentStarted } from "./cursor-feed/turn";

const WIDGET = "cursor-feed";

/** The Esc listener of the main session; replaced on each session start and switch. */
let unbindEscape: (() => void) | undefined;
/** The interactive mode that last focused an agent session. */
let focusMode: InteractiveMode | undefined;
/** The main TUI, whose overlay state the Esc listener reads. */
let mainTui: TuiRef | undefined;

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

export default function cursorFeed(pi: ExtensionAPI) {
	installFocus();
	installCursorFeed();
    installTurn();
	installSubagents();

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
