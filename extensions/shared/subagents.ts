// Subagent runtime: role files, a pool of warm sessions, and non-blocking delivery of finals to Main.
import type { AgentSession, ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { createAgentSession, SessionManager } from "@oh-my-pi/pi-coding-agent";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export interface Role {
	name: string;
	prompt: string;
	tools: string[] | undefined;
	meta: Record<string, string>;
}

/** A launch target: a role on a model ("" means Main's model) and a thinking level. */
export interface Spec {
	role: Role;
	model: string;
	thinking: string;
}

/** Reads agents/<name>.md: front matter as key-value lines, the body as the role prompt. */
export function loadRole(name: string): Role {
	const text = readFileSync(join(import.meta.dir, "..", "..", "agents", `${name}.md`), "utf8");
	const head = /^---\n([\s\S]*?)\n---\n/.exec(text);
	const meta: Record<string, string> = {};
	for (const line of (head?.[1] ?? "").split("\n")) {
		const at = line.indexOf(":");
		if (at > 0) meta[line.slice(0, at).trim()] = line.slice(at + 1).trim().replace(/^"|"$/g, "");
	}
	const tools = meta.tools?.split(",").map(tool => tool.trim()).filter(Boolean);
	return { name, prompt: text.slice(head?.[0].length ?? 0).trim(), tools, meta };
}

const keyOf = (spec: Spec) => `${spec.role.name}|${spec.model}|${spec.thinking}`;

// Idle warm sessions and sessions still being created, per launch target.
const idle = new Map<string, AgentSession[]>();
const starting = new Map<string, Promise<AgentSession>[]>();
// Sessions that ran a task: the next task starts from a clean history.
const used = new WeakSet<AgentSession>();
const all = new Set<AgentSession>();

async function create(spec: Spec, ctx: ExtensionContext): Promise<AgentSession> {
	const model = spec.model === "" ? ctx.model : undefined;
	const { session } = await createAgentSession({
		cwd: ctx.cwd,
		modelRegistry: ctx.modelRegistry,
		authStorage: ctx.modelRegistry.authStorage,
		model,
		modelPattern: model ? undefined : spec.model,
		thinkingLevel: spec.thinking as never,
		toolNames: spec.role.tools,
		sessionManager: SessionManager.inMemory(ctx.cwd),
		taskDepth: 1,
		agentName: spec.role.name,
		appendSystemPrompt: spec.role.prompt,
		hasUI: false,
		cacheWarming: false,
		autoTitle: false,
		enableMCP: false,
		enableLsp: spec.role.tools?.includes("lsp") === true,
	});
	all.add(session);
	return session;
}

/** Starts one session for the target in the background, so its first task skips session setup. */
export function prestart(spec: Spec, ctx: ExtensionContext): void {
	const key = keyOf(spec);
	const promise = create(spec, ctx);
	promise.catch(() => {});
	starting.set(key, [...(starting.get(key) ?? []), promise]);
}

async function acquire(spec: Spec, ctx: ExtensionContext): Promise<AgentSession> {
	const key = keyOf(spec);
	const warm = idle.get(key)?.pop();
	if (warm) return warm;
	const early = starting.get(key)?.shift();
	if (early) {
		try {
			return await early;
		} catch {}
	}
	return create(spec, ctx);
}

/** Runs one task on a warm session of the target and returns the subagent's last message. */
export async function runTask(spec: Spec, text: string, ctx: ExtensionContext): Promise<string> {
	const session = await acquire(spec, ctx);
	try {
		// A reused session keeps its system prompt and tools; only the previous task's history goes.
		if (used.has(session)) await session.newSession();
		used.add(session);
		await session.prompt(text);
		await session.waitForIdle();
		return session.getLastAssistantText()?.trim() || "(the subagent returned no text)";
	} finally {
		idle.set(keyOf(spec), [...(idle.get(keyOf(spec)) ?? []), session]);
	}
}

/** Every file's current content, for a task that would otherwise start by reading them. */
export async function fileBlocks(paths: string[], cwd: string): Promise<string> {
	const blocks = await Promise.all(
		paths.map(async path => {
			try {
				return `<file path="${path}">\n${await readFile(resolve(cwd, path), "utf8")}\n</file>`;
			} catch {
				return `<file path="${path}">(does not exist yet)</file>`;
			}
		}),
	);
	return blocks.join("\n");
}

// Finals not yet delivered, launches still running, and whether Main is waiting for them at its stop.
const running = new Set<Promise<void>>();
const undelivered: string[] = [];
let mainWaiting = false;
let counter = 0;

/** Starts a task without blocking Main; its final reaches Main as a message. Returns the task id. */
export function launch(pi: ExtensionAPI, label: string, work: () => Promise<string>): string {
	const id = `${label}#${++counter}`;
	const done: Promise<void> = work()
		.then(
			text => `[${id}] ${text}`,
			error => `[${id}] failed: ${error instanceof Error ? error.message : String(error)}`,
		)
		.then(message => {
			if (mainWaiting) undelivered.push(message);
			else pi.sendMessage({ customType: "subagent-result", content: message, display: true }, { deliverAs: "aside", triggerTurn: true });
		})
		.finally(() => running.delete(done));
	running.add(done);
	return id;
}

/** At Main's stop: waits for the first running task when nothing is pending, and returns the finals to continue with. */
export async function collectAtStop(): Promise<string[]> {
	if (running.size === 0 && undelivered.length === 0) return [];
	mainWaiting = true;
	try {
		if (undelivered.length === 0) await Promise.race(running);
		return undelivered.splice(0);
	} finally {
		mainWaiting = false;
	}
}

export async function disposeAll(): Promise<void> {
	await Promise.all([...all].map(session => session.dispose().catch(() => {})));
	all.clear();
	idle.clear();
	starting.clear();
}

/** Result of a launch tool call. */
export function started(id: string) {
	return { content: [{ type: "text" as const, text: `Started ${id}. Its final arrives as a message starting with [${id}]; keep working meanwhile.` }] };
}
