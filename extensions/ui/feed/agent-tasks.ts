// Per-task display metrics of a sub-agent. A task starts at Main's latest `[task <id>#<n>]`
// IRC message; its counts are the assistant messages after that message. Nothing is written:
// a parked or stopped agent's task is read once from its session file, read-only, and the
// result lives on globalThis, like the other feed slots.
import { SessionManager } from "@oh-my-pi/pi-coding-agent";
import { type AgentRef, AgentRegistry } from "@oh-my-pi/pi-coding-agent/registry/agent-registry";
import { dirname } from "node:path";

/** One numbered task of a sub-agent, as the hub shows it. */
export interface AgentTask {
	/** Task number; 1 until Main sends a numbered `[task <id>#<n>]` message. */
	number: number;
	/** Task start in ms since the epoch. */
	startedAt: number;
	/** Input, output and cache-write tokens of the task's assistant messages. */
	tokens: number;
	/** Tool calls in the task's assistant messages. */
	toolCount: number;
	/** Assistant messages of the task. */
	requests: number;
	/** Elapsed ms: running time while the ref runs, else from the task start to the ref's last activity. */
	durationMs: number;
}

type Counts = Omit<AgentTask, "durationMs">;

interface TaskState {
	/** Last measured task per agent id; null when its session file could not be read. */
	tasks: Map<string, AgentTask | null>;
	/** Callbacks of the file read in progress, per agent id. */
	reading: Map<string, Array<() => void>>;
}

const STATE = Symbol.for("my-omp-harness.feed.agent-tasks.state");
const state = ((globalThis as Record<symbol, unknown>)[STATE] ??= {
	tasks: new Map(),
	reading: new Map(),
}) as TaskState;

const MARKER = /^\[task [^\]\s]+#(\d+)\]/;
const ASSIGNMENT = /^\s*Complete assignment thoroughly:/i;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function finite(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function timestampOf(message: unknown): number | undefined {
	if (!isRecord(message) || typeof message.timestamp !== "number") return undefined;
	return Number.isFinite(message.timestamp) ? message.timestamp : undefined;
}

/** The task number of Main's numbered IRC message; undefined for any other message. */
function taskNumberOf(message: unknown): number | undefined {
	if (!isRecord(message) || message.role !== "custom" || message.customType !== "irc:incoming") return undefined;
	const details = message.details;
	if (!isRecord(details) || details.fromParent !== true || typeof details.message !== "string") return undefined;
	const match = MARKER.exec(details.message.trimStart());
	return match ? Number(match[1]) : undefined;
}

function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content.map(part => (isRecord(part) && typeof part.text === "string" ? part.text : "")).join("\n");
}

/** Timestamp of the first user message with omp's assignment prefix. */
function assignmentTimestamp(messages: readonly unknown[]): number | undefined {
	for (const message of messages) {
		if (isRecord(message) && message.role === "user" && ASSIGNMENT.test(textOf(message.content))) {
			return timestampOf(message);
		}
	}
	return undefined;
}

/** Adds one assistant message with the definitions of omp's own session metrics. */
function addAssistant(total: Counts, message: unknown): void {
	if (!isRecord(message) || message.role !== "assistant") return;
	const usage: Record<string, unknown> = isRecord(message.usage) ? message.usage : {};
	const content: unknown[] = Array.isArray(message.content) ? message.content : [];
	total.requests++;
	total.tokens += finite(usage.input) + finite(usage.output) + finite(usage.cacheWrite);
	total.toolCount += content.filter(part => isRecord(part) && part.type === "toolCall").length;
}

/**
 * Counts of the task a transcript holds. The newest numbered marker starts the task, so the scan
 * stops there and sums only the suffix after it; without a marker the task is task 1 and the
 * whole transcript, started by the first assignment.
 */
function scan(messages: readonly unknown[], ref: AgentRef): Counts {
	let boundary = -1;
	let number = 1;
	for (let i = messages.length - 1; i >= 0; i--) {
		const found = taskNumberOf(messages[i]);
		if (found === undefined) continue;
		boundary = i;
		number = found;
		break;
	}
	const started = boundary >= 0 ? timestampOf(messages[boundary]) : assignmentTimestamp(messages);
	const total: Counts = { number, startedAt: started ?? ref.createdAt, tokens: 0, toolCount: 0, requests: 0 };
	for (let i = boundary + 1; i < messages.length; i++) addAssistant(total, messages[i]);
	return total;
}

/** Measures the task of a transcript and caches it. */
function measure(ref: AgentRef, messages: readonly unknown[]): AgentTask {
	const counts = scan(messages, ref);
	const durationMs =
		ref.status === "running"
			? Math.max(0, Date.now() - counts.startedAt)
			: Math.max(0, ref.lastActivity - counts.startedAt);
	const task: AgentTask = { ...counts, durationMs };
	state.tasks.set(ref.id, task);
	return task;
}

/**
 * The current numbered task of a sub-agent, or undefined while it is unknown. A live session is
 * measured directly. Otherwise the task comes from the session file, read once; until that read
 * ends, or when the file cannot be read, there is no task and none is invented. `onReady` runs
 * when the read ends.
 */
export function getAgentTask(ref: AgentRef, onReady?: () => void): AgentTask | undefined {
	const session = ref.session;
	if (session) {
		try {
			return measure(ref, session.messages);
		} catch {
			// Fall through to the cached task.
		}
	}
	if (state.tasks.has(ref.id)) return state.tasks.get(ref.id) ?? undefined;
	if (ref.sessionFile) readOnce(ref, onReady);
	return undefined;
}

/** Starts the file read of a ref once; `onReady` joins the read already in progress. */
function readOnce(ref: AgentRef, onReady?: () => void): void {
	const waiting = state.reading.get(ref.id);
	if (waiting) {
		if (onReady) waiting.push(onReady);
		return;
	}
	state.reading.set(ref.id, onReady ? [onReady] : []);
	void readTask(ref).then(task => {
		state.tasks.set(ref.id, task);
		const callbacks = state.reading.get(ref.id) ?? [];
		state.reading.delete(ref.id);
		for (const callback of callbacks) callback();
	});
}

/** Reads the current task from a ref's session file; null when the file cannot be read. */
async function readTask(ref: AgentRef): Promise<AgentTask | null> {
	const file = ref.sessionFile;
	if (!file) return null;
	let manager: SessionManager | undefined;
	try {
		// suppressBreadcrumb keeps the terminal breadcrumb as it is; throwIfMissing keeps a missing
		// file a failure instead of a new session. The directory is the file's own, so none is created.
		// Opening claims nothing, and close() writes nothing when no write happened.
		manager = await SessionManager.open(file, dirname(file), undefined, {
			suppressBreadcrumb: true,
			throwIfMissing: true,
		});
		return measure(ref, branchMessages(manager.getBranch()));
	} catch {
		return null;
	} finally {
		await manager?.close().catch(() => undefined);
	}
}

/** Session entries as messages: message entries as they are, custom message entries with a numeric timestamp. */
function branchMessages(branch: readonly unknown[]): unknown[] {
	const messages: unknown[] = [];
	for (const entry of branch) {
		if (!isRecord(entry)) continue;
		if (entry.type === "message") {
			messages.push(entry.message);
		} else if (entry.type === "custom_message") {
			messages.push({
				role: "custom",
				customType: entry.customType,
				details: entry.details,
				timestamp: typeof entry.timestamp === "string" ? Date.parse(entry.timestamp) : undefined,
			});
		}
	}
	return messages;
}

/** Measures a sub-agent's current task from its session branch and caches it. */
export function updateAgentTask(id: string, branch: readonly unknown[]): void {
	const ref = AgentRegistry.global().get(id);
	if (!ref) return;
	measure(ref, branchMessages(branch));
}
