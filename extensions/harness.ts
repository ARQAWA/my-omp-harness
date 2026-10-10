import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { isKeyRelease, matchesKey } from "@oh-my-pi/pi-tui";
import { readFileSync } from "node:fs";
import { join } from "node:path";

let goalState: "none" | "active" | "paused" = "none";
let unsubscribe: (() => void) | undefined;
let pendingFollowUp: { text: string; images?: unknown[] } | undefined;

const GOLD = join(import.meta.dir, "..", "skills", "gold-standard", "SKILL.md");
const COMM = join(import.meta.dir, "..", "skills", "clear-communication", "SKILL.md");
const MAIN = join(import.meta.dir, "..", "skills", "main-workflow", "SKILL.md");
const TOOLS = join(import.meta.dir, "..", "skills", "omp-tools", "SKILL.md");
const DEFINE = join(import.meta.dir, "define-goal.md");
const SLOT = Symbol.for("my-omp-harness.progress");
type ProgressSlot = {
	state?: { item: string; steps: string[]; current: number };
	canShow?: (item: string) => boolean;
	sync?: () => void;
};
const slot = ((globalThis as Record<symbol, unknown>)[SLOT] ??= {}) as ProgressSlot;
const PROGRESS = "my-omp-harness.progress";
let progressUi: ExtensionContext["ui"] | undefined;
let barLine: string[] | undefined;
let barHidden = false;
// The panel calls sync after it changes whether it draws the bar; the separate widget follows that decision.
slot.sync = () => {
	if (!progressUi || !barLine || !slot.state) return;
	const hide = slot.canShow?.(slot.state.item) === true;
	if (hide === barHidden) return;
	barHidden = hide;
	try {
		progressUi.setWidget(PROGRESS, hide ? undefined : barLine);
	} catch {
		// The UI may already be gone; the next progress call sets the widget again.
	}
};
export default function harness(pi: ExtensionAPI) {
	const z = pi.zod;
	let progressItem: string | undefined;

	// Root Main keeps omp's goal tool, which omp removes when a goal completes or is dropped; subagents get no progress tool.
	const syncTools = async (kind: string) => {
		const active = await pi.getActiveTools();
		const next =
			kind === "sub"
				? active.filter(name => name !== "progress")
				: active.includes("goal")
					? active
					: [...active, "goal"];
		if (next.length !== active.length) await pi.setActiveTools(next);
	};
	pi.on("session_start", async (_event, ctx) => syncTools(ctx.agent.kind));
	pi.on("agent_end", async (_event, ctx) => syncTools(ctx.agent.kind));

	pi.registerTool({
		name: "progress",
		label: "Progress",
		loadMode: "essential",
		description:
			"Show the substeps of the in-progress todo item as a bar in the in-progress task's row of the todo panel. item: the exact content of that todo item. steps: its substeps in order. current: the number of the current substep, from 1. Call it when the item starts and whenever the current substep changes; an empty steps list removes the bar. The bar disappears by itself when a todo update leaves the item not in progress.",
		parameters: z.object({ item: z.string(), steps: z.array(z.string()), current: z.number() }),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const total = params.steps.length;
			if (total === 0) {
				progressItem = undefined;
				slot.state = undefined;
				barLine = undefined;
				ctx.ui.setWidget(PROGRESS, undefined);
				return { content: [{ type: "text", text: "Progress bar removed." }] };
			}
			const current = Math.min(Math.max(1, Math.round(params.current)), total);
			progressItem = params.item;
			slot.state = { item: params.item, steps: params.steps, current };
			const bar = params.steps.map((_step, index) => (index < current ? "▰" : "▱")).join("");
			progressUi = ctx.ui;
			barLine = [`${bar} ${current}/${total} ${params.steps[current - 1]}`];
			barHidden = slot.canShow?.(params.item) === true;
			ctx.ui.setWidget(PROGRESS, barHidden || !barLine ? undefined : barLine);
			return { content: [{ type: "text", text: `Shown in the in-progress task's row of the todo panel: substep ${current} of ${total}.` }] };
		},
	});
	// The bar belongs to one todo item and disappears once a todo update leaves that item not in progress.
	pi.on("tool_result", async (event, ctx) => {
		if (event.toolName !== "todo" || event.isError || progressItem === undefined) return;
		const phases = (event.details as { phases?: { tasks: { content: string; status: string }[] }[] } | undefined)?.phases ?? [];
		if (phases.some(phase => phase.tasks.some(task => task.status === "in_progress" && task.content === progressItem))) return;
		progressItem = undefined;
		slot.state = undefined;
		barLine = undefined;
		ctx.ui.setWidget(PROGRESS, undefined);
	});

	// ctrl+shift+P pauses or resumes the session goal by sending the matching /goal command, when the editor is empty.
	const bindPauseKey = (ctx: ExtensionContext) => {
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
			// omp's continue shortcuts ("." or "c" then Enter while paused) never reach input handlers, so this resumes the goal before they run.
			if (!isKeyRelease(data) && matchesKey(data, "enter") && goalState === "paused" && [".", "c"].includes(ctx.ui.getEditorText().trim())) {
				ctx.ui.setEditorText("/goal resume");
				return { data: "\r" };
			}
			if (isKeyRelease(data) || !matchesKey(data, "ctrl+shift+p") || goalState === "none" || ctx.ui.getEditorText() !== "") return undefined;
			ctx.ui.setEditorText(goalState === "active" ? "/goal pause" : "/goal resume");
			return { data: "\r" };
		});
	};
	pi.on("session_start", (_event, ctx) => bindPauseKey(ctx));
	pi.on("session_switch", (_event, ctx) => bindPauseKey(ctx));
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
		if (status === "active" && pendingFollowUp !== undefined) {
			const { text, images } = pendingFollowUp;
			pendingFollowUp = undefined;
			const content = images?.length ? [{ type: "text", text }, ...images] : text;
			ctx.setTimeout(() => pi.sendUserMessage(content), 0);
		}
	});

	pi.on("before_agent_start", async (event, ctx) => {
		const tools = `Apply the following omp tool mechanics to every tool call. Source: ${TOOLS}\n\n${readFileSync(TOOLS, "utf8")}`;
		// A subagent works from its definition and brief: drop block 0 (SYSTEM.md and the skill list) and add only the tool mechanics.
		if (ctx.agent.kind === "sub") return { systemPrompt: [...event.systemPrompt.slice(1), tools] };
		const define = /^Define goal(?::|$)/.test(event.prompt.trimStart());
		return {
			systemPrompt: [
				...event.systemPrompt,
				`Apply the full Gold Standard to all work. Apply silently. Source: ${GOLD}\n\n${readFileSync(GOLD, "utf8")}`,
				tools,
				`Apply the following root Main workflow for plan mode, todo, progress and the goal. Source: ${MAIN}\n\n${readFileSync(MAIN, "utf8")}`,
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
				: {}),
		};
	});
}
