import { TranscriptContainer } from "@oh-my-pi/pi-tui/chrome";
import { isNativeRendering } from "@oh-my-pi/pi-tui/native/state";

export interface CallResult {
	content: Array<{ type: string; text?: string }>;
	details?: unknown;
	isError?: boolean;
}

/** Start and end of one tool block, in performance.now() milliseconds. */
export interface Timing {
	startedAt?: number;
	endedAt?: number;
}

/** One read call inside a ReadToolGroupComponent. */
export interface ReadAction extends Timing {
	args: unknown;
	result?: CallResult;
	isPartial: boolean;
	startedAt: number;
}

export const timings = new WeakMap<object, Timing>();
/** Last global Ctrl+O value recorded per component. */
export const globalExpanded = new WeakMap<object, boolean>();
/** Component -> the TranscriptContainer it was added to. */
export const parents = new WeakMap<object, { children: readonly object[] }>();
/** Read calls of each ReadToolGroupComponent, keyed by tool call id. */
export const readGroups = new WeakMap<object, Map<string, ReadAction>>();
/** Last message given to an AssistantMessageComponent. */
export const assistantMessages = new WeakMap<object, { content?: unknown; stopReason?: unknown; timestamp?: unknown }>();
export const toolActivityVisible = new WeakMap<object, boolean>();
export const allocations = new WeakMap<object, number>();

/** One subagent of a task call: its latest progress, or its settled result. */
export interface AgentRecord {
	id: string;
	agent: string;
	description?: string;
	status: "pending" | "running" | "completed" | "failed" | "aborted";
	lastIntent?: string;
	currentTool?: string;
	currentToolArgs?: string;
}

/** Latest record per subagent id across every task block; read by the live-agents panel. */
export const agentRecords = new Map<string, AgentRecord>();
/** Render kind of a tool block, set once a painter claims the block. */
export const blockKinds = new WeakMap<object, string>();
/** Paints a claimed tool block; undefined keeps the original view. */
export type Painter = (owner: object, width: number, args: unknown) => readonly string[] | undefined;
/** Painters by block kind (the tool name). */
export const painters = new Map<string, Painter>();

/** Expansion is only the global Ctrl+O flag. */
export function isExpanded(component: object): boolean {
	return globalExpanded.get(component) ?? false;
}

/** The current global Ctrl+O flag, as last recorded by any expandable component. */
export function expandedNow(): boolean {
	return lastGlobal ?? false;
}

export interface TuiRef {
	requestRender(): void;
	resetDisplay(): void;
	/** The TUI's children; the main chat transcript is one of them. */
	readonly children?: readonly object[];
	/** Whether an overlay is open over the main view. */
	hasOverlay?(): boolean;
}

let tuiRef: TuiRef | undefined;
let lastGlobal: boolean | undefined;
let resetPending = false;

export function setTuiRef(ref: TuiRef | undefined): void {
	tuiRef = ref;
}

/** Patches act only in the main TUI session and under ANSI rendering. */
export function enabled(): boolean {
	return tuiRef !== undefined && !isNativeRendering();
}

/** Transcript containers that are direct children of the TUI (the main chat transcript). */
export function topTranscripts(): TranscriptContainer[] {
	return (tuiRef?.children ?? []).filter((child): child is TranscriptContainer => child instanceof TranscriptContainer);
}

/**
 * Schedules one deferred repaint: forgets the append-only emission ledger of the
 * main transcript, then clears the scrollback and replays the whole transcript.
 */
export function scheduleReset(): void {
	if (resetPending) return;
	resetPending = true;
	setTimeout(() => {
		resetPending = false;
		for (const transcript of topTranscripts()) {
			try {
				transcript.resetStableEmission();
			} catch {
				// Fail safe: the repaint still runs.
			}
		}
		tuiRef?.resetDisplay();
	}, 0);
}

/** Records a component's Ctrl+O value; one scrollback reset per global change. */
export function recordExpanded(component: object, expanded: boolean): void {
	globalExpanded.set(component, expanded);
	if (lastGlobal === undefined) {
		lastGlobal = expanded;
		return;
	}
	if (lastGlobal === expanded) return;
	lastGlobal = expanded;
	scheduleReset();
}
