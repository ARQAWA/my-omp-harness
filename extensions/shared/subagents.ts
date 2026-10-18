// Subagent runtime: role files, a pool of warm sessions, and non-blocking delivery of finals to Main.
import type { AgentSession, ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { createAgentSession, SessionManager, settings } from "@oh-my-pi/pi-coding-agent";
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
	/** Model and thinking without Anthropic credentials; default gpt-6-luna medium. */
	fallback?: { model: string; thinking: string };
	/** Model and thinking used first whenever its provider has credentials. */
	prefer?: { model: string; thinking: string };
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

// Without Anthropic credentials, Anthropic roles run on their fallback, by default gpt-6-luna at medium effort.
const FALLBACK = { model: "openai-codex/gpt-6-luna", thinking: "medium" };

// "provider/id" refs; the id may itself contain slashes.
function hasAuth(ref: string, ctx: ExtensionContext): boolean {
	const at = ref.indexOf("/");
	const model = ctx.modelRegistry.find(ref.slice(0, at), ref.slice(at + 1));
	return model !== undefined && ctx.modelRegistry.hasConfiguredAuth(model);
}

function effective(spec: Spec, ctx: ExtensionContext): Spec {
	if (spec.prefer && hasAuth(spec.prefer.model, ctx)) return { ...spec, ...spec.prefer };
	if (!spec.model.startsWith("anthropic/") || hasAuth(spec.model, ctx)) return spec;
	return { ...spec, ...(spec.fallback ?? FALLBACK) };
}

// omp loads every extension file with its own import tag, so each extension gets its own copy of this module; the state lives on globalThis so all copies share it.
// idle: warm sessions per launch target. starting: sessions still being created, per target. used: sessions that ran a task, so the next task starts from a clean history. all: every session, for disposeAll. running: launches in flight. undelivered: finals not yet delivered. mainWaiting: Main is waiting for finals at its stop. counter: task id sequence. sessions: agent id sequence.
const state: { idle: Map<string, AgentSession[]>; starting: Map<string, Promise<AgentSession>[]>; used: WeakSet<AgentSession>; all: Set<AgentSession>; running: Set<Promise<void>>; undelivered: string[]; mainWaiting: boolean; counter: number; sessions: number } = ((globalThis as any).__ompliteSubagents ??= { idle: new Map(), starting: new Map(), used: new WeakSet(), all: new Set(), running: new Set(), undelivered: [], mainWaiting: false, counter: 0, sessions: 0 });

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
		agentId: `${spec.role.name}-${++state.sessions}`,
		appendSystemPrompt: spec.role.prompt,
		hasUI: false,
		cacheWarming: false,
		autoTitle: false,
		enableMCP: false,
		enableLsp: spec.role.tools?.includes("lsp") === true,
		// A preferred model fails fast, so runTask can rerun the task on the regular model.
		settings: spec.prefer && spec.model === spec.prefer.model ? settings.overlay({ "retry.enabled": false }) : undefined,
	});
	state.all.add(session);
	return session;
}

/** Starts one session for the target in the background, so its first task skips session setup. */
export function prestart(target: Spec, ctx: ExtensionContext): void {
	const spec = effective(target, ctx);
	const key = keyOf(spec);
	const promise = create(spec, ctx);
	promise.catch(() => {});
	state.starting.set(key, [...(state.starting.get(key) ?? []), promise]);
}

async function acquire(spec: Spec, ctx: ExtensionContext): Promise<AgentSession> {
	const key = keyOf(spec);
	const warm = state.idle.get(key)?.pop();
	if (warm) return warm;
	const early = state.starting.get(key)?.shift();
	if (early) {
		try {
			return await early;
		} catch {}
	}
	return create(spec, ctx);
}

/** Runs one task on a warm session of the target and returns the subagent's last message. */
async function runOnce(target: Spec, text: string, ctx: ExtensionContext): Promise<{ text: string; failed: boolean }> {
	const spec = effective(target, ctx);
	const session = await acquire(spec, ctx);
	try {
		// A reused session keeps its system prompt and tools; only the previous task's history goes.
		if (state.used.has(session)) await session.newSession();
		state.used.add(session);
		await session.prompt(text);
		await session.waitForIdle();
		const failed = session.getLastAssistantMessage()?.stopReason === "error";
		return { text: session.getLastAssistantText()?.trim() || "(the subagent returned no text)", failed };
	} finally {
		state.idle.set(keyOf(spec), [...(state.idle.get(keyOf(spec)) ?? []), session]);
	}
}

/** Runs one task; if the preferred model fails, reruns the task once on the spec without prefer. */
export async function runTask(target: Spec, text: string, ctx: ExtensionContext): Promise<string> {
	const onPreferred = target.prefer !== undefined && effective(target, ctx).model === target.prefer.model;
	const first = await runOnce(target, text, ctx);
	if (!first.failed || !onPreferred) return first.text;
	return (await runOnce({ ...target, prefer: undefined }, text, ctx)).text;
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

/** Starts a task without blocking Main; its final reaches Main as a message. Returns the task id. */
export function launch(pi: ExtensionAPI, label: string, work: () => Promise<string>): string {
	const id = `${label}#${++state.counter}`;
	const done: Promise<void> = work()
		.then(
			text => `[${id}] ${text}`,
			error => `[${id}] failed: ${error instanceof Error ? error.message : String(error)}`,
		)
		.then(message => {
			if (state.mainWaiting) state.undelivered.push(message);
			else {
				try {
					pi.sendMessage({ customType: "subagent-result", content: message, display: true }, { deliverAs: "aside", triggerTurn: true });
				} catch {
					// Main's session is already gone; nobody is left to read the final.
				}
			}
		})
		.finally(() => state.running.delete(done));
	state.running.add(done);
	return id;
}

/** At Main's stop: waits for the first running task when nothing is pending, and returns the finals to continue with. */
export async function collectAtStop(): Promise<string[]> {
	if (state.running.size === 0 && state.undelivered.length === 0) return [];
	state.mainWaiting = true;
	try {
		// omp cuts a session_stop handler at 30 s, so wait at most 25 s and continue Main for another wait.
		if (state.undelivered.length === 0) await Promise.race([...state.running, Bun.sleep(25_000)]);
		const finals = state.undelivered.splice(0);
		if (finals.length > 0 || state.running.size === 0) return finals;
		return [`${state.running.size} subagent task(s) still running. End your response without tool calls; each final wakes you. Do not run filler commands.`];
	} finally {
		state.mainWaiting = false;
	}
}

export async function disposeAll(): Promise<void> {
	await Promise.all([...state.all].map(session => session.dispose().catch(() => {})));
	state.all.clear();
	state.idle.clear();
	state.starting.clear();
}

/** Result of a launch tool call. */
export function started(id: string) {
	return { content: [{ type: "text" as const, text: `Started ${id}. Its final arrives as a message starting with [${id}]. Keep doing your own part of the task; when nothing else is left, end your response without tool calls and the final wakes you. Never poll and never run filler commands such as pwd, ls or git status.` }] };
}
