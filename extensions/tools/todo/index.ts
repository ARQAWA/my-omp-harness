import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { type Component, Text } from "@oh-my-pi/pi-tui";
import { type ToolRenderer, toolRenderers } from "@oh-my-pi/pi-tui/tools";
import { onStop } from "../../shared/stop.ts";
import { todoOps } from "../../shared/todo-ops.ts";
import { currentMode } from "../../ui/feed/panel";
import description from "./description.md" with { type: "text" };


type Status = "pending" | "in_progress" | "completed" | "abandoned" | "blocked";
type Item = { content: string; status: Status; blocker?: string };
type Phase = { name: string; tasks: Item[] };
type Plan = { steps: string[]; current: number };
type TodoState = { phases: Phase[]; plans: Map<string, Plan> };
type ItemSpec = string | { title?: string; plan?: string[] };
type OpName = "init" | "append" | "start" | "done" | "drop" | "block" | "unblock" | "rm" | "plan" | "step" | "closed";
type Op = {
	op: OpName;
	item?: string;
	phase?: string;
	list?: { phase?: string; items?: ItemSpec[] }[];
	items?: ItemSpec[];
	reason?: string;
	steps?: string[];
	step?: number;
};
type Entry = { phase: number; index: number; item: Item; num: string };
type Outcome = { content: { type: "text"; text: string }[]; isError: boolean; details?: unknown };

const MARK: Record<Status, string> = { completed: "✓", in_progress: "●", pending: "○", blocked: "⊘", abandoned: "✗" };
const TODO_BLOCK = /<todo_context>[\s\S]*?<\/todo_context>|<todo>[\s\S]*?<\/todo>|<todo-reminder>[\s\S]*?<\/todo-reminder>/g;
const TODO_REMINDER = [
	"<todo-reminder>",
	"No todo list is open. For a task beyond one answer or one short action, init its list together with your first tool calls.",
	"</todo-reminder>",
].join("\n");

const SLOT = Symbol.for("my-omp-harness.progress");
// The session entry that carries the list after each change.
const STATE_ENTRY = "todo_state";
type ProgressSlot = {
	state?: { item: string; steps: string[]; current: number };
	setTodos?: (phases: Phase[]) => void;
};
const slot = ((globalThis as Record<symbol, unknown>)[SLOT] ??= {}) as ProgressSlot;

const isBare = (ctx: ExtensionContext) => {
	const model = (ctx as any).models?.current?.() ?? (ctx as any).model;
	return /dolphin-mistral-24b-venice-edition/i.test(model?.id ?? "");
};

class OpError extends Error {
	readonly reason: string;
	readonly fix: string;
	constructor(reason: string, fix: string) {
		super(reason);
		this.reason = reason;
		this.fix = fix;
	}
}

function fail(text: string) {
	return { content: [{ type: "text" as const, text }], isError: true };
}

function normalize(text: string): string {
	return text
		.normalize("NFKC")
		.toLowerCase()
		.replace(/\u2192|\u21D2|\u27F6|=>|->/g, "->")
		.replace(/[\u2014\u2013\u2212\u2010\u2011]/g, "-")
		.replace(/[\u00AB\u00BB\u201C\u201D\u201E\u2018\u2019"'`]/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

function matchBy<T>(pool: T[], text: (value: T) => string, query: string): T[] {
	const wanted = normalize(query);
	if (wanted === "") return [];
	const exact = pool.filter(value => normalize(text(value)) === wanted);
	if (exact.length > 0) return exact;
	return pool.filter(value => {
		const candidate = normalize(text(value));
		return candidate !== "" && (candidate.includes(wanted) || wanted.includes(candidate));
	});
}

function keyOf(phaseName: string, title: string): string {
	return `${phaseName}\u0000${title}`;
}

function isOpen(status: Status): boolean {
	return status === "pending" || status === "in_progress" || status === "blocked";
}

function capitalize(text: string): string {
	return text.charAt(0).toUpperCase() + text.slice(1);
}

function label(op: Op): string {
	return op.item !== undefined ? `${op.op} ${op.item}` : op.op;
}

// Drops optional fields that are empty strings or empty arrays, and a non-positive step.
function clean(value: unknown): unknown {
	if (typeof value === "string") return value.trim() === "" ? undefined : value;
	if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : undefined;
	if (Array.isArray(value)) {
		const kept = value.map(clean).filter(part => part !== undefined);
		return kept.length > 0 ? kept : undefined;
	}
	if (value !== null && typeof value === "object") {
		const out: Record<string, unknown> = {};
		for (const [key, part] of Object.entries(value)) {
			const cleaned = clean(part);
			if (cleaned !== undefined) out[key] = cleaned;
		}
		return out;
	}
	return value;
}

function allItems(next: TodoState): Entry[] {
	return next.phases.flatMap((phase, p) => phase.tasks.map((item, i) => ({ phase: p, index: i, item, num: `${p + 1}.${i + 1}` })));
}

function itemKey(next: TodoState, entry: Entry): string {
	return keyOf(next.phases[entry.phase]!.name, entry.item.content);
}

function show(entry: Entry): string {
	return `${entry.num} "${entry.item.content}"`;
}

function openList(next: TodoState): string {
	return allItems(next).filter(entry => isOpen(entry.item.status)).map(show).join("; ") || "none";
}

function itemSpec(spec: ItemSpec): { title: string; plan?: string[] } {
	const title = (typeof spec === "string" ? spec : (spec.title ?? "")).trim();
	if (title === "") throw new OpError("an item has no title", "give every item a title");
	const plan = typeof spec === "string" ? undefined : spec.plan;
	return plan?.length ? { title, plan } : { title };
}

function claim(titles: Set<string>, title: string): void {
	const key = normalize(title);
	if (titles.has(key)) throw new OpError(`item "${title}" is listed twice`, "keep each title once; give one of them another title or drop it");
	titles.add(key);
}

// Phase by number (1-based, when in range), else by forgiving name match; an unknown name is a new phase.
function resolvePhase(next: TodoState, query: string): number | string {
	const text = query.trim();
	const number = /^\d+$/.test(text) ? Number(text) : 0;
	if (number >= 1 && number <= next.phases.length) return number - 1;
	const found = matchBy(
		next.phases.map((phase, i) => ({ phase, i })),
		entry => entry.phase.name,
		text,
	);
	if (found.length === 1) return found[0]!.i;
	if (found.length > 1) {
		throw new OpError(
			`several phases match "${text}": ${found.map(entry => `${entry.i + 1} ${entry.phase.name}`).join(", ")}`,
			"repeat the op with phase set to one of these numbers or exact names",
		);
	}
	return text;
}

function defaultPhase(next: TodoState): number {
	const active = next.phases.findIndex(phase => phase.tasks.some(item => item.status === "in_progress"));
	if (active >= 0) return active;
	const pending = next.phases.findIndex(phase => phase.tasks.some(item => item.status === "pending"));
	if (pending >= 0) return pending;
	return next.phases.length - 1;
}

// Item by number ("2.3") or by text; several text matches resolve to the single open one.
function locate(next: TodoState, query: string | undefined, op: OpName): Entry {
	if (query === undefined) throw new OpError(`${op} needs an item`, 'name the item by number like 2.3 or by its text, e.g. "done 2.3"');
	const text = query.trim();
	const entries = allItems(next);
	if (/^\d+\.\d+$/.test(text)) {
		const exact = entries.find(entry => entry.num === text);
		if (exact) return exact;
		throw new OpError(`no item ${text}. Open items: ${openList(next)}`, "repeat the op with item set to a number from the open items above");
	}
	const found = matchBy(entries, entry => entry.item.content, text);
	if (found.length === 1) return found[0]!;
	if (found.length > 1) {
		const open = found.filter(entry => isOpen(entry.item.status));
		if (open.length === 1) return open[0]!;
		throw new OpError(`several items match "${text}": ${found.map(show).join("; ")}`, "repeat the op with item set to one of these numbers");
	}
	throw new OpError(`no item matches "${text}". Open items: ${openList(next)}`, "repeat the op with item set to the number or exact text of an open item above");
}

// plan and step default to the in-progress item.
function resolveDefault(next: TodoState, query: string | undefined, op: OpName): Entry {
	if (query !== undefined) return locate(next, query, op);
	const active = allItems(next).find(entry => entry.item.status === "in_progress");
	if (!active) throw new OpError(`${op} has no item and none is in progress`, 'name the item by number like 2.3 or by its text, e.g. "done 2.3"');
	return active;
}

function init(next: TodoState, op: Op): string {
	if (!op.list?.length) throw new OpError("init has no list", `write "init Phase: item | item"`);
	const phases: Phase[] = [];
	const plans = new Map<string, Plan>();
	const names = new Set<string>();
	const titles = new Set<string>();
	for (const group of op.list) {
		const name = (group.phase ?? "").trim();
		if (name === "") throw new OpError("a phase has no name", `give every phase a name in list, e.g. {phase: "Research", items: [...]}`);
		if (!group.items?.length) throw new OpError(`phase "${name}" has no items`, `give "${name}" at least one item, or drop it from list`);
		if (names.has(normalize(name))) throw new OpError(`phase "${name}" is listed twice`, "merge its items into one phase entry");
		names.add(normalize(name));
		const tasks: Item[] = [];
		for (const spec of group.items) {
			const { title, plan } = itemSpec(spec);
			claim(titles, title);
			tasks.push({ content: title, status: "pending" });
			if (plan) plans.set(keyOf(name, title), { steps: plan, current: 1 });
		}
		phases.push({ name, tasks });
	}
	next.phases = phases;
	next.plans = plans;
	return `list set: ${allItems(next).length} items in ${phases.length} phases`;
}

function append(next: TodoState, op: Op): string {
	if (!op.items?.length) throw new OpError("append has no items", `write "append: item | item"`);
	const specs = op.items.map(itemSpec);
	const taken = new Set(allItems(next).map(entry => normalize(entry.item.content)));
	let index = -1;
	let name = "Todos";
	if (op.phase !== undefined) {
		const target = resolvePhase(next, op.phase);
		if (typeof target === "number") {
			index = target;
			name = next.phases[target]!.name;
		} else {
			name = target;
		}
	} else {
		index = defaultPhase(next);
		if (index >= 0) name = next.phases[index]!.name;
	}
	if (index < 0) {
		next.phases.push({ name, tasks: [] });
		index = next.phases.length - 1;
	}
	const phase = next.phases[index]!;
	const added: string[] = [];
	for (const { title, plan } of specs) {
		if (taken.has(normalize(title))) throw new OpError(`item "${title}" already exists`, "use the existing item by its number, or give this one another title");
		taken.add(normalize(title));
		phase.tasks.push({ content: title, status: "pending" });
		if (plan) next.plans.set(keyOf(phase.name, title), { steps: plan, current: 1 });
		added.push(`${index + 1}.${phase.tasks.length} "${title}"`);
	}
	return `added ${added.join(", ")} to ${phase.name}`;
}

// Lists the closed items of the covered phases: every phase, or the one phase given.
function closedLines(next: TodoState, op: Op): string[] {
	let covered = next.phases.map((_phase, p) => p);
	if (op.phase !== undefined) {
		const target = resolvePhase(next, op.phase);
		if (typeof target === "string") {
			const known = next.phases.map((phase, i) => `${i + 1} ${phase.name}`).join(", ") || "none";
			throw new OpError(`no phase matches "${target}". Phases: ${known}`, "repeat the op with phase set to a number or exact name from the phases above");
		}
		covered = [target];
	}
	const lines: string[] = [];
	for (const p of covered) {
		const phase = next.phases[p]!;
		const items = phase.tasks.flatMap((item, i) => (isOpen(item.status) ? [] : [`${p + 1}.${i + 1} ${MARK[item.status]} ${item.content}`]));
		if (items.length > 0) lines.push(`${p + 1} ${phase.name}`, ...items);
	}
	return lines.length > 0 ? lines : ["No closed items."];
}

const OP_NAMES = new Set<OpName>(["init", "append", "start", "done", "drop", "block", "unblock", "rm", "plan", "step", "closed"]);

/**
 * A short op written as text, "<op> [item or phase][: text]": "done 1.2", "start 1.3", "step", "step 3",
 * "block 1.4: waits for the key", "plan: first | second", "plan 2.1: first | second", "init Phase: item | item",
 * "append: item | item", "append Phase: item", "closed". It costs a few tokens where the object form costs dozens.
 */
function parseOpText(text: string): Op {
	const colon = text.indexOf(":");
	const head = (colon < 0 ? text : text.slice(0, colon)).trim();
	const tail = colon < 0 ? undefined : text.slice(colon + 1).trim();
	const [word = "", ...restWords] = head.split(/\s+/);
	const name = word.toLowerCase() as OpName;
	if (!OP_NAMES.has(name)) {
		throw new OpError(`unknown op "${text}"`, 'write it as "<op> [item][: text]", e.g. "done 1.2" or "plan: first | second"');
	}
	const rest = restWords.join(" ").trim();
	const target = rest === "" ? undefined : rest;
	const parts = tail === undefined ? [] : tail.split("|").map(part => part.trim()).filter(part => part !== "");
	switch (name) {
		case "init":
			return { op: name, list: [{ phase: target, items: parts }] };
		case "append":
			return { op: name, phase: target, items: parts };
		case "block":
			return { op: name, item: target, reason: tail };
		case "plan":
			return { op: name, item: target, steps: parts };
		case "step": {
			const words = rest === "" ? [] : rest.split(/\s+/);
			const last = words[words.length - 1];
			if (last !== undefined && /^\d+$/.test(last)) return { op: name, item: words.slice(0, -1).join(" ") || undefined, step: Number(last) };
			return { op: name, item: target };
		}
		case "closed":
			return { op: name, phase: target };
		default:
			return { op: name, item: target ?? (tail || undefined) };
	}
}

function applyOp(next: TodoState, op: Op, report: string[]): string {
	switch (op.op) {
		case "init":
			return init(next, op);
		case "append":
			return append(next, op);
		case "start": {
			const target = locate(next, op.item, "start");
			for (const entry of allItems(next)) if (entry.item.status === "in_progress") entry.item.status = "pending";
			target.item.status = "in_progress";
			return `started ${target.num} "${target.item.content}"`;
		}
		case "done":
		case "drop": {
			// Without an item, done and drop close the current one.
			const target = resolveDefault(next, op.item, op.op);
			delete target.item.blocker;
			target.item.status = op.op === "done" ? "completed" : "abandoned";
			return `${op.op === "done" ? "done" : "dropped"} ${target.num}`;
		}
		case "block": {
			const target = locate(next, op.item, "block");
			const reason = op.reason?.trim();
			if (!reason) throw new OpError("block has no reason", `write "block <item>: what it waits for"`);
			target.item.status = "blocked";
			target.item.blocker = reason;
			return `blocked ${target.num}: ${reason}`;
		}
		case "unblock": {
			const target = locate(next, op.item, "unblock");
			delete target.item.blocker;
			target.item.status = "pending";
			return `unblocked ${target.num}`;
		}
		case "rm": {
			const target = locate(next, op.item, "rm");
			const key = itemKey(next, target);
			next.phases[target.phase]!.tasks.splice(target.index, 1);
			next.plans.delete(key);
			return `removed ${target.num} "${target.item.content}"`;
		}
		case "plan": {
			if (!op.steps?.length) throw new OpError("plan has no steps", `write "plan: first step | second step"`);
			const target = resolveDefault(next, op.item, "plan");
			next.plans.set(itemKey(next, target), { steps: op.steps, current: 1 });
			return `plan ${target.num}: ${op.steps.length} steps`;
		}
		case "step": {
			const target = resolveDefault(next, op.item, "step");
			const plan = next.plans.get(itemKey(next, target));
			if (!plan) throw new OpError(`${target.num} has no plan`, `add its steps first: "plan ${target.num}: step | step"`);
			const total = plan.steps.length;
			if (op.step !== undefined) {
				if (op.step > total) throw new OpError(`step ${op.step} is outside 1..${total}`, `pass step from 1 to ${total}, or omit step to move on by one`);
				plan.current = op.step;
			} else {
				plan.current = Math.min(plan.current + 1, total + 1);
			}
			return plan.current > total ? `all ${total} steps of ${target.num} marked` : `step ${target.num}: ${plan.current}/${total}`;
		}
		case "closed":
			report.push(...closedLines(next, op));
			return "listed closed items";
		default:
			throw new OpError(`unknown op ${String(op.op)}`, "use one of init, append, start, done, drop, block, unblock, rm, plan, step, closed");
	}
}

// At most one item in progress; with none, the first pending item in list order starts.
function settle(next: TodoState): TodoState {
	const entries = allItems(next);
	const active = entries.filter(entry => entry.item.status === "in_progress");
	for (const extra of active.slice(1)) extra.item.status = "pending";
	if (active.length === 0) {
		const pending = entries.find(entry => entry.item.status === "pending");
		if (pending) pending.item.status = "in_progress";
	}
	return next;
}

function nextLine(next: TodoState): string {
	const entries = allItems(next);
	if (!entries.some(entry => isOpen(entry.item.status))) return "All items are closed; the list leaves the context.";
	const active = entries.find(entry => entry.item.status === "in_progress");
	if (!active) return `No item is in progress; start one with "start <item>".`;
	const plan = next.plans.get(itemKey(next, active));
	if (!plan) return `Next: ${active.num} "${active.item.content}" has no plan; add its steps with "plan: step | step".`;
	if (plan.current > plan.steps.length) return `All steps of ${active.num} are marked; close it with "done".`;
	return `Now: ${active.num} "${active.item.content}", step ${plan.current}/${plan.steps.length} "${plan.steps[plan.current - 1]}".`;
}

function planText(plan: Plan): string {
	const total = plan.steps.length;
	const text = plan.steps
		.map((step, index) => {
			const mark = index + 1 < plan.current ? "✓" : index + 1 === plan.current ? "▸" : "○";
			return `${mark}${index + 1} ${step}`;
		})
		.join(" · ");
	return plan.current > total ? `${text} · all steps marked` : text;
}

function snapshot(next: TodoState): string {
	const entries = allItems(next);
	const open = entries.filter(entry => isOpen(entry.item.status)).length;
	const lines = ["<todo>", `Your todo list; item numbers work in every todo op. ${open} of ${entries.length} open; closed items are folded, list them with "closed".`];
	next.phases.forEach((phase, p) => {
		if (phase.tasks.length === 0) {
			lines.push(`${p + 1} ${phase.name} — empty`);
			return;
		}
		const closedCount = phase.tasks.filter(item => !isOpen(item.status)).length;
		lines.push(`${p + 1} ${phase.name} — ${closedCount}/${phase.tasks.length} closed`);
		phase.tasks.forEach((item, i) => {
			if (!isOpen(item.status)) return;
			const blocked = item.status === "blocked" ? ` — blocked: ${item.blocker ?? ""}` : "";
			lines.push(`  ${p + 1}.${i + 1} ${MARK[item.status]} ${item.content}${blocked}`);
			const plan = next.plans.get(keyOf(phase.name, item.content));
			if (item.status === "in_progress" && plan) lines.push(`      plan: ${planText(plan)}`);
		});
	});
	lines.push("</todo>");
	return lines.join("\n");
}

// Plans are kept only for items that still exist.
function livePlans(raw: unknown, phases: Phase[]): Map<string, Plan> {
	const plans = new Map<string, Plan>();
	if (typeof raw !== "object" || raw === null) return plans;
	const live = new Set(phases.flatMap(phase => phase.tasks.map(item => keyOf(phase.name, item.content))));
	for (const [key, value] of Object.entries(raw)) {
		const plan = value as Partial<Plan> | null;
		if (!plan || !live.has(key)) continue;
		if (!Array.isArray(plan.steps) || plan.steps.length === 0 || typeof plan.current !== "number") continue;
		plans.set(key, { steps: plan.steps, current: plan.current });
	}
	return plans;
}

// The newest branch entry that omp accepts as the todo state.
function restore(sessionManager: { getBranch(): unknown }): TodoState {
	const entries = sessionManager.getBranch();
	if (!Array.isArray(entries)) return { phases: [], plans: new Map() };
	for (let index = entries.length - 1; index >= 0; index--) {
		const entry = entries[index] as
			| {
					type?: string;
					customType?: string;
					data?: { phases?: unknown; plans?: unknown };
					message?: {
						role?: string;
						toolName?: string;
						isError?: boolean;
						details?: { phases?: unknown; plans?: unknown };
					};
			  }
			| undefined;
		const edited = entry?.data?.phases;
		if (entry?.type === "custom" && entry.customType === "user_todo_edit" && Array.isArray(edited)) {
			return { phases: edited as Phase[], plans: new Map() };
		}
		// Written on every change, so ops sent in other tools' todo fields survive a restart and a compaction.
		if (entry?.type === "custom" && entry.customType === STATE_ENTRY && Array.isArray(edited)) {
			return { phases: edited as Phase[], plans: livePlans(entry.data?.plans, edited as Phase[]) };
		}
		const message = entry?.message;
		if (entry?.type !== "message" || !message || message.role !== "toolResult" || message.toolName !== "todo") continue;
		const details = message.details;
		if (!details || !Array.isArray(details.phases)) continue;
		const phases = details.phases as Phase[];
		return { phases, plans: livePlans(details.plans, phases) };
	}
	return { phases: [], plans: new Map() };
}

// Publishes the in-progress item and its plan to the slot that the todo panel draws; clears the slot without a plan.
function showProgress(next: TodoState): void {
	const active = allItems(next).find(entry => entry.item.status === "in_progress");
	const plan = active ? next.plans.get(itemKey(next, active)) : undefined;
	if (!active || !plan) {
		slot.state = undefined;
		return;
	}
	const total = plan.steps.length;
	const current = Math.min(Math.max(1, plan.current), total);
	slot.state = { item: active.item.content, steps: plan.steps, current };
}

// omp's goal context is a custom message that the agent attributes to itself; only that envelope carries omp's own todo list.
function isGoalModeContext(message: unknown): boolean {
	const record = message as { role?: unknown; customType?: unknown; attribution?: unknown };
	return record.role === "custom" && record.customType === "goal-mode-context" && record.attribution === "agent";
}

function stripTodoBlock<T>(message: T): T {
	const record = message as unknown as { customType?: unknown; content?: unknown };
	if (typeof record.content === "string") {
		const text = record.content.replace(TODO_BLOCK, "");
		return text === record.content ? message : ({ ...record, content: text } as T);
	}
	if (!Array.isArray(record.content)) return message;
	let changed = false;
	const parts = record.content.map((part: unknown) => {
		const p = part as { type?: unknown; text?: unknown } | null;
		if (p?.type !== "text" || typeof p.text !== "string") return part;
		const text = p.text.replace(TODO_BLOCK, "");
		if (text === p.text) return part;
		changed = true;
		return { ...p, text };
	});
	return changed ? ({ ...record, content: parts } as T) : message;
}

/** The first line of the first text block of a tool result. */
function firstTextLine(result: unknown): string {
	const content =
		typeof result === "object" && result !== null && "content" in result && Array.isArray(result.content)
			? result.content
			: [];
	for (const block of content) {
		if (typeof block === "object" && block !== null && "text" in block && typeof block.text === "string") {
			return block.text.split("\n")[0] ?? "";
		}
	}
	return "";
}

/** True when the newest message is the user's own, so this request is the first of his turn. */
function opensUserTurn(messages: readonly unknown[]): boolean {
	const last = messages[messages.length - 1] as { role?: unknown; attribution?: unknown } | undefined;
	return last?.role === "user" && last.attribution !== "agent";
}

export default function todo(pi: ExtensionAPI) {
	// OMPLITE_TODO=off removes the tool, its context and its stop check, for the A/B bench.
	if (process.env.OMPLITE_TODO === "off") return;
	const z = pi.zod;
	// The list of this extension instance. A child's todo calls change only its own list.
	let state: TodoState | undefined;
	// A newer title request of the same session replaces an older one still in flight.
	let titleSequence = 0;

	function currentState(sessionManager: { getBranch(): unknown }): TodoState {
		return (state ??= restore(sessionManager));
	}

	// One background title request per new list, so the session name follows the task; nothing until omp has named it.
	function refreshTitle(ctx: ExtensionContext, input: string): void {
		const session = currentMode()?.session;
		if (!session || input === "" || !pi.getSessionName()) return;
		const sessionId = ctx.sessionManager.getSessionId();
		const sequence = ++titleSequence;
		void (async () => {
			const title = await session.generateTitle(input);
			if (!title || sequence !== titleSequence || ctx.sessionManager.getSessionId() !== sessionId) return;
			await pi.setSessionName(title);
		})().catch(() => undefined);
	}

	// Outcomes of todo tool calls applied while the response was prepared, and notes on failed todo fields.
	const prepared = new Map<string, Outcome>();
	const notes = new Map<string, string>();

	// Applies ops in order; the first failing op stops the rest. A change is saved to the session and shown on the panel.
	function applyOps(rawOps: unknown, ctx: ExtensionContext): Outcome {
		const raws = (Array.isArray(rawOps) ? rawOps : []).map(raw => clean(raw)).filter(raw => raw !== undefined);
		if (raws.length === 0) return fail(`todo needs at least one op. Fix: pass ops: ["start 1.1"].`);
		const ops: Op[] = [];
		const start = currentState(ctx.sessionManager);
		const before = new Set(allItems(start).filter(entry => entry.item.status === "completed").map(entry => itemKey(start, entry)));
		let working: TodoState = structuredClone(start);
		const applied: string[] = [];
		const report: string[] = [];
		let failure: { index: number; error: OpError } | undefined;
		for (const [index, raw] of raws.entries()) {
			const trial = structuredClone(working);
			try {
				const op = typeof raw === "string" ? parseOpText(raw) : (raw as Op);
				ops.push(op);
				applied.push(applyOp(trial, op, report));
				working = settle(trial);
			} catch (failed) {
				if (!(failed instanceof OpError)) throw failed;
				failure = { index, error: failed };
				break;
			}
		}
		const committed = applied.length > 0 ? working : start;
		const lines: string[] = [];
		if (applied.length > 0) lines.push(`${capitalize(applied.join("; "))}.`);
		const stop = failure;
		if (stop) {
			const failed = raws[stop.index];
			const parts = [`Stopped at op ${stop.index + 1} (${typeof failed === "string" ? failed : (failed as Op).op}): ${stop.error.reason}. Fix: ${stop.error.fix}.`];
			const rest = raws.slice(stop.index + 1).map((op, offset) => `op ${stop.index + 2 + offset} (${typeof op === "string" ? op : label(op as Op)})`);
			if (rest.length > 0) parts.push(`Not applied: ${rest.join(", ")}.`);
			lines.push(parts.join(" "));
			lines.push(snapshot(committed));
		} else {
			lines.push(nextLine(committed));
		}
		lines.push(...report);
		if (applied.length === 0) return { content: [{ type: "text" as const, text: lines.join("\n") }], isError: true };
		state = committed;
		const plans = Object.fromEntries(committed.plans);
		pi.appendEntry(STATE_ENTRY, { phases: committed.phases, plans });
		if (ctx.agent.kind === "main" && ctx.hasUI) {
			showProgress(committed);
			slot.setTodos?.(committed.phases);
			if (ops.slice(0, applied.length).some(op => op.op === "init")) refreshTitle(ctx, snapshot(committed));
		}
		const completedTasks = allItems(committed)
			.filter(entry => entry.item.status === "completed" && !before.has(itemKey(committed, entry)))
			.map(entry => ({ content: entry.item.content }));
		return {
			content: [{ type: "text" as const, text: lines.join("\n") }],
			isError: stop !== undefined,
			details: { op: "ops", phases: committed.phases, plans, completedTasks },
		};
	}

	// omp prepares all calls of a response in order before any of them runs; applying ops here keeps the todo tool and the
	// todo fields of other calls in call order, and a field never delays the call it rides on.
	pi.on("tool_call", (event, ctx) => {
		if (ctx.agent.kind !== "main" || isBare(ctx)) return undefined;
		const input = event.input as Record<string, unknown>;
		if (event.toolName === "todo") {
			prepared.set(event.toolCallId, applyOps(input.ops, ctx));
			return undefined;
		}
		if (!Array.isArray(input.todo) || input.todo.length === 0) return undefined;
		const outcome = applyOps(input.todo, ctx);
		// A field that worked stays silent: the list in the next request shows it. A failure is added to the call's result.
		if (outcome.isError) notes.set(event.toolCallId, outcome.content.map(part => part.text).join("\n"));
		return undefined;
	});
	pi.on("tool_result", event => {
		const note = notes.get(event.toolCallId);
		if (note === undefined) return undefined;
		notes.delete(event.toolCallId);
		return { content: [...event.content, { type: "text" as const, text: `todo field: ${note}` }] };
	});
	pi.on("agent_end", () => {
		prepared.clear();
		notes.clear();
	});

	const restoreOnSession = (_event: unknown, ctx: ExtensionContext) => {
		state = undefined;
		titleSequence += 1;
		if (ctx.agent.kind !== "main" || !ctx.hasUI) return;
		const restored = currentState(ctx.sessionManager);
		slot.setTodos?.(restored.phases);
		showProgress(restored);
	};
	pi.on("session_start", restoreOnSession);
	pi.on("session_switch", restoreOnSession);
	pi.on("session_branch", restoreOnSession);
	pi.on("session_tree", restoreOnSession);

	pi.on("context", (event, ctx) => {
		if (ctx.agent.kind !== "main" || isBare(ctx)) return undefined;
		const current = currentState(ctx.sessionManager);
		const messages = event.messages.map(message => (isGoalModeContext(message) ? stripTodoBlock(message) : message));
		let changed = messages.some((message, index) => message !== event.messages[index]);
		// The open list goes into every request; the reminder only into the first request after the user's message.
		const open = allItems(current).some(entry => isOpen(entry.item.status));
		if (!open && !opensUserTurn(event.messages)) return changed ? { messages } : undefined;
		const text = open ? snapshot(current) : TODO_REMINDER;
		messages.push({
			role: "user",
			content: [{ type: "text", text }],
			attribution: "agent",
			timestamp: Date.now(),
		} as unknown as (typeof messages)[number]);
		changed = true;
		return changed ? { messages } : undefined;
	});

	// Runs after the subagent wait in the one shared stop handler, so a todo refusal never drops a subagent final.
	onStop("todo", 1, ctx => {
		if (isBare(ctx)) return undefined;
		const open = allItems(currentState(ctx.sessionManager)).filter(entry => entry.item.status === "pending" || entry.item.status === "in_progress");
		if (open.length === 0) return undefined;
		return [
			"The todo list still has open items:",
			...open.map(entry => `- ${entry.num} ${entry.item.content} (${entry.item.status})`),
			"Before finishing, mark each one done, drop it if it is no longer needed, or block it with a reason if it waits for the user or another event.",
		].join("\n");
	});

	pi.registerTool({
		name: "todo",
		label: "todo",
		loadMode: "essential",
		concurrency: "shared",
		approval: "read",
		description: description.trim(),
		parameters: z.object({ ops: todoOps(z) }),
		async execute(toolCallId, rawParams, _signal, _onUpdate, ctx) {
			// Applied already when the response's calls were prepared, in call order with the todo fields of other calls.
			const done = prepared.get(toolCallId);
			if (done) {
				prepared.delete(toolCallId);
				return done;
			}
			return applyOps(rawParams.ops, ctx);
		},
		renderCall: (...args: Parameters<ToolRenderer["renderCall"]>): Component => {
			const host = toolRenderers["todo"];
			return host ? (host.renderCall(...args) as Component) : new Text("todo", 0, 0);
		},
		renderResult: (...args: Parameters<ToolRenderer["renderResult"]>): Component => {
			const host = toolRenderers["todo"];
			return host ? (host.renderResult(...args) as Component) : new Text(firstTextLine(args[0]), 0, 0);
		},
	});
}
