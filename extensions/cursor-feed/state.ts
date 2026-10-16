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
/** Transcript rows added by cursor-feed itself (dialog answers, goal events); a turn fold never hides them. */
export const pinnedRows = new WeakSet<object>();
/** Trimmed goal objectives seen in this session. */
export const goalObjectives = new Set<string>();
let toolNameResolver: ((component: object) => string | undefined) | undefined;

/** Sets the function that names a tool block by its tool. */
export function setToolNameResolver(resolver: (component: object) => string | undefined): void {
	toolNameResolver = resolver;
}

/** The tool name of a tool block; undefined until a resolver is set. */
export function toolNameOf(component: object): string | undefined {
	return toolNameResolver?.(component);
}

/** One subagent of a task call: its latest progress, or its settled result. */
export interface AgentRecord {
	id: string;
	agent: string;
	description?: string;
	status: "pending" | "running" | "completed" | "failed" | "aborted";
	lastIntent?: string;
	currentTool?: string;
	currentToolArgs?: string;
	/** Full task text. */
	task?: string;
	/** Date.now() when the record was first created. */
	startedAt?: number;
	durationMs?: number;
	tokens?: number;
	toolCount?: number;
	requests?: number;
	/** Resolved model display string (resolvedModel). */
	model?: string;
	/** Resolved thinking level (resolvedThinkingLevel). */
	thinking?: string;
	/** First 600 characters of the result output. */
	output?: string;
	error?: string;
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

const SHARED = Symbol.for("my-omp-harness.cursor-feed.shared");
/** A composer's last setRuntimeChildren call, with the original bound to that composer. */
interface RuntimeChildrenCall {
	args: unknown[];
	original: (...args: unknown[]) => unknown;
}
/** Process-wide state of cursor-feed: each extension file loads its own module copy, so module variables are not shared. */
export const shared = ((globalThis as Record<symbol, unknown>)[SHARED] ??= {}) as {
	tui?: TuiRef;
	mainMode?: unknown;
	/** The last setRuntimeChildren call of each tracked composer. */
	runtimeChildren?: WeakMap<object, RuntimeChildrenCall>;
};
let lastGlobal: boolean | undefined;
let resetPending = false;
let floorPending = false;
/** Set on a composer once its setRuntimeChildren is wrapped. */
const TRACKED_CHILDREN = Symbol.for("my-omp-harness.cursor-feed.runtime-children");

export function setTuiRef(ref: TuiRef | undefined): void {
	shared.tui = ref;
}

/** Patches act only in the main TUI session and under ANSI rendering. */
export function enabled(): boolean {
	return shared.tui !== undefined && !isNativeRendering();
}

/** Transcript containers that are direct children of the TUI (the main chat transcript). */
export function topTranscripts(): TranscriptContainer[] {
	return (shared.tui?.children ?? []).filter((child): child is TranscriptContainer => child instanceof TranscriptContainer);
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
		shared.tui?.resetDisplay();
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
	promoteChromeFloor();
}

/** Wraps a composer's setRuntimeChildren once, recording each call's arguments and its bound original. */
export function trackRuntimeChildren(composer: object): void {
	const record = composer as unknown as Record<symbol, unknown>;
	if (record[TRACKED_CHILDREN]) return;
	record[TRACKED_CHILDREN] = true;
	const target = composer as { setRuntimeChildren: (...args: unknown[]) => unknown };
	const original = target.setRuntimeChildren.bind(composer);
	target.setRuntimeChildren = (...args: unknown[]) => {
		runtimeCalls().set(composer, { args, original });
		return original(...args);
	};
}

/** The last setRuntimeChildren call of every tracked composer, kept on the shared state. */
function runtimeCalls(): WeakMap<object, RuntimeChildrenCall> {
	return (shared.runtimeChildren ??= new WeakMap<object, RuntimeChildrenCall>());
}

/** Schedules one re-run of the main composer's last setRuntimeChildren call, 300 ms later, to raise omp's chrome floor. */
export function promoteChromeFloor(): void {
	if (floorPending) return;
	floorPending = true;
	// omp's chrome floor never rises while the harness keeps tall chrome; remove this when an omp release raises the floor itself.
	setTimeout(() => {
		floorPending = false;
		try {
			const composer = (shared.mainMode as { composer?: object } | undefined)?.composer;
			const call = composer ? runtimeCalls().get(composer) : undefined;
			if (call) call.original(...call.args);
		} catch {
			// Fail safe: the floor stays where omp left it.
		}
	}, 300);
}
