import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { StatusLineComponent } from "@oh-my-pi/pi-coding-agent";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

let goalState: "none" | "active" | "paused" = "none";
let unsubscribe: (() => void) | undefined;
let pendingFollowUp: { text: string; images?: unknown[] } | undefined;
let goalCommandAt = 0;
let ownerPaused = false;
let resuming = false;
type GoalSession = {
	getGoalModeState?(): { goal?: { status: string } } | undefined;
	goalRuntime: { resumeGoal(): Promise<unknown> };
	isStreaming: boolean;
	sendGoalModeContext(options: { deliverAs: "steer" }): Promise<void>;
};
let goalSession: GoalSession | undefined;

const GOAL_RESUME = Symbol.for("my-omp-harness.goal-resume");
const globals = globalThis as Record<symbol, unknown>;
if (globals[GOAL_RESUME] !== true) {
	globals[GOAL_RESUME] = true;
	const proto = StatusLineComponent.prototype as unknown as { setGoalModeStatus(status: unknown): void };
	const original = proto.setGoalModeStatus;
	proto.setGoalModeStatus = function (this: { session?: GoalSession }, status: unknown) {
		try {
			if (this.session?.getGoalModeState?.()?.goal) goalSession = this.session;
		} catch {}
		return original.call(this, status);
	};
}

// The goal resumes when the agent works again after a pause that the owner did not make with a /goal command.
const resumeIfWorking = async (ctx: ExtensionContext) => {
	if (ctx.agent.kind !== "main" || goalState !== "paused" || ownerPaused || resuming) return;
	const session = goalSession;
	if (!session || session.getGoalModeState?.()?.goal?.status !== "paused") return;
	resuming = true;
	try {
		await session.goalRuntime.resumeGoal();
		if (session.isStreaming) await session.sendGoalModeContext({ deliverAs: "steer" });
	} catch {
	} finally {
		resuming = false;
	}
};

const GOLD = join(import.meta.dir, "..", "skills", "gold-standard", "SKILL.md");
const COMM = join(import.meta.dir, "..", "skills", "clear-communication", "SKILL.md");
const MAIN = join(import.meta.dir, "..", "skills", "main-workflow", "SKILL.md");
const TOOLS = join(import.meta.dir, "..", "skills", "omp-tools", "SKILL.md");
const SUBAGENTS = join(import.meta.dir, "..", "skills", "subagents", "SKILL.md");
const DEFINE = join(import.meta.dir, "define-goal.md");
const ENV_PROGRAMS = ["git", "node", "bun", "npm", "pnpm", "python3", "python", "cargo", "rustc", "go", "java", "docker", "gh", "rg", "fd", "jq", "make", "cmake"];
const ENVIRONMENT = (() => {
	const found = ENV_PROGRAMS.filter(name => Bun.which(name) !== null);
	const home = homedir().replace(/\\/g, "/");
	const winExtra = process.platform === "win32" ? ", never /c/... or backslashes" : "";
	return `Environment: shell: the bash tool runs an embedded bash-compatible shell with built-in grep, sed, find, xargs, jq and coreutils; paths: absolute like ${home}/... with forward slashes${winExtra}; programs on PATH: ${found.length ? found.join(", ") : "none found"}.`;
})();
const GPT_NOTES =
	"GPT tool notes, from recorded sessions: " +
	"Use paths returned by listing, search or read; get the settings directory with `omp config path` and setting names with `omp config list`. " +
	"Use the listed PATH programs. Read internal URLs with `read`; selectors such as `:raw` are not shell paths. " +
	"Read `xd://` topics without line selectors. In computer calls, use a window ID from the current window list; refresh the list after a missing-window error. " +
	"A rejected patch hunk comes back with its expected lines and the closest match: re-read that region and resend only the rejected hunks.";
// Non-Latin layouts send the letter's own codepoint, so ctrl/alt shortcuts are mapped to the Latin key in the same position.
const RUSSIAN_TO_LATIN: Record<string, string> = {
	й: "q", ц: "w", у: "e", к: "r", е: "t", н: "y", г: "u", ш: "i", щ: "o", з: "p", х: "[", ъ: "]",
	ф: "a", ы: "s", в: "d", а: "f", п: "g", р: "h", о: "j", л: "k", д: "l", ж: ";", э: "'",
	я: "z", ч: "x", с: "c", м: "v", и: "b", т: "n", ь: "m", б: ",", ю: ".", ё: "`",
};
const CSI_U = /^\x1b\[(\d+)(?::\d*)*(;(\d+)(?::\d+)?)?u$/;
const latinShortcut = (data: string): string | undefined => {
	const match = CSI_U.exec(data);
	if (!match || Number(match[1]) > 0x10ffff) return undefined;
	const latin = RUSSIAN_TO_LATIN[String.fromCodePoint(Number(match[1])).toLowerCase()];
	const modifiers = Math.max(Number(match[3] ?? 1) - 1, 0); // shift = 1, alt = 2, ctrl = 4
	if (latin === undefined || (modifiers & 6) === 0) return undefined;
	return `\x1b[${latin.codePointAt(0)}${data.slice(2 + match[1].length)}`;
};

export default function harness(pi: ExtensionAPI) {
	// Root Main keeps omp's goal tool, which omp removes when a goal completes or is dropped.
	const syncTools = async (kind: string) => {
		const active = await pi.getActiveTools();
		const next =
			kind === "sub"
				? active
				: active.includes("goal")
					? active
					: [...active, "goal"];
		// Every agent gets these tools active from session start; questions go into the chat, so omp's `ask` stays inactive; a name is added only when omp lists it among all tools.
		const all = typeof pi.getAllTools === "function" ? ((await pi.getAllTools()) as (string | { name: string })[]) : undefined;
		const known = all?.map(tool => (typeof tool === "string" ? tool : tool.name));
		const final = [
			...next.filter(name => name !== "ask"),
			...["grep", "lsp", "ast_grep"].filter(name => !next.includes(name) && (known === undefined || known.includes(name))),
		];
		if (final.length !== active.length || final.some((name, index) => name !== active[index])) await pi.setActiveTools(final);
	};
	pi.on("session_start", async (_event, ctx) => syncTools(ctx.agent.kind));
	pi.on("agent_end", async (_event, ctx) => syncTools(ctx.agent.kind));

	const bindKeys = (ctx: ExtensionContext) => {
		unsubscribe?.();
		unsubscribe = undefined;
		let mode: string | undefined;
		try {
			mode = ctx.sessionManager.buildSessionContext().mode;
		} catch {
			mode = undefined;
		}
		goalState = mode === "goal" ? "active" : mode === "goal_paused" ? "paused" : "none";
		unsubscribe = ctx.ui.onTerminalInput(data => {
			const remapped = latinShortcut(data);
			return remapped === undefined ? undefined : { data: remapped };
		});
	};
	pi.on("session_start", (_event, ctx) => bindKeys(ctx));
	pi.on("session_switch", (_event, ctx) => bindKeys(ctx));
	pi.on("input", (event, ctx) => {
		pendingFollowUp = undefined;
		if (ctx.agent.kind !== "main") return undefined;
		let mode: string | undefined;
		try {
			mode = ctx.sessionManager.buildSessionContext().mode;
		} catch {
			mode = undefined;
		}
		const text = event.text.trim();
		if (text.startsWith("/goal")) goalCommandAt = Date.now();
		// A follow-up typed while the goal is paused resumes the goal through omp's /goal resume; the text is delivered once the goal is active again.
		if (event.source === "interactive" && mode === "goal_paused" && text !== "" && !text.startsWith("/") && !text.startsWith("!")) {
			pendingFollowUp = { text: event.text, images: event.images };
			return { text: "/goal resume", images: [] };
		}
		return undefined;
	});
	pi.registerCommand("define-goal", {
		description: "Define a goal: interview, verbatim quotes, success criteria with checks, blind review before completion",
		handler: async (args, ctx) => {
			let mode: string | undefined;
			try {
				mode = ctx.sessionManager.buildSessionContext().mode;
			} catch {
				mode = undefined;
			}
			if (mode === "plan" || mode === "plan_paused") {
				ctx.ui.notify("/define-goal is unavailable in plan mode. Leave plan mode first.", "info");
				return;
			}
			if (mode === "goal" || mode === "goal_paused") {
				ctx.ui.notify("A goal is already set. Complete or drop it with /goal before /define-goal.", "info");
				return;
			}
			await ctx.waitForIdle();
			const rough = args.trim();
			pi.sendUserMessage(rough ? `Define goal: ${rough}` : "Define goal");
		},
	});
	pi.on("goal_updated", (event, ctx) => {
		const status = event.goal?.status;
		goalState = status === "active" ? "active" : status === "paused" ? "paused" : "none";
		if (status === "paused") {
			ownerPaused = Date.now() - goalCommandAt <= 60_000;
		} else if (status === "active") {
			ownerPaused = false;
		}
		goalCommandAt = 0;
		if (status === "active" && pendingFollowUp !== undefined) {
			const { text, images } = pendingFollowUp;
			pendingFollowUp = undefined;
			const content = images?.length ? [{ type: "text", text }, ...images] : text;
			ctx.setTimeout(() => pi.sendUserMessage(content), 0);
		}
	});

	pi.on("agent_start", async (_event, ctx) => {
		await resumeIfWorking(ctx);
	});
	pi.on("turn_start", async (_event, ctx) => {
		await resumeIfWorking(ctx);
	});
	pi.on("tool_call", async (_event, ctx) => {
		await resumeIfWorking(ctx);
	});
	pi.on("message_start", async (event, ctx) => {
		if (event.message?.role === "assistant") await resumeIfWorking(ctx);
	});

	pi.on("before_agent_start", async (event, ctx) => {
		const model = (ctx as any).models?.current?.() ?? (ctx as any).model;
		const gpt = /gpt/i.test(model?.id ?? "");
		const tools = `Apply the following omp tool mechanics to every tool call. Source: ${TOOLS}\n\n${readFileSync(TOOLS, "utf8")}\n\n${ENVIRONMENT}${gpt ? `\n\n${GPT_NOTES}` : ""}`;
		if (ctx.agent.kind === "sub") return { systemPrompt: [...event.systemPrompt, tools] };
		const define = /^Define goal(?::|$)/.test(event.prompt.trimStart());
		let mode: string | undefined;
		try {
			mode = ctx.sessionManager.buildSessionContext().mode;
		} catch {
			mode = undefined;
		}
		const paused = ctx.agent.kind === "main" && mode === "goal_paused";
		return {
			systemPrompt: [
				...event.systemPrompt,
				`Apply the full Gold Standard to all work. Apply silently. Source: ${GOLD}\n\n${readFileSync(GOLD, "utf8")}`,
				tools,
				`Apply the following root Main workflow for work classes, todo and the goal. Source: ${MAIN}\n\n${readFileSync(MAIN, "utf8")}`,
				`Apply the following subagent rules to every subagent launch. Source: ${SUBAGENTS}\n\n${readFileSync(SUBAGENTS, "utf8")}`,
				`Apply the following communication skill before every user-facing message. Source: ${COMM}\n\n${readFileSync(COMM, "utf8")}`,
			],
			...(define
				? {
						message: {
							customType: "my-omp-harness.define-goal",
							content: `Follow this procedure for the goal the user just started with /define-goal. Source: ${DEFINE}\n\n${readFileSync(DEFINE, "utf8")}`,
							display: false,
						},
					}
				: paused
					? {
							message: {
								customType: "my-omp-harness.goal-paused",
								content: "The goal is paused while you are working. Call the goal tool with op resume first, in the same response as your first work calls.",
								display: false,
							},
						}
					: {}),
		};
	});
}
