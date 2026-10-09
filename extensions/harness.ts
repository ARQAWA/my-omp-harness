import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { isKeyRelease, matchesKey } from "@oh-my-pi/pi-tui";
import { readFileSync } from "node:fs";
import { join } from "node:path";

let goalState: "none" | "active" | "paused" = "none";
let unsubscribe: (() => void) | undefined;

const GOLD = join(import.meta.dir, "..", "skills", "gold-standard", "SKILL.md");
const COMM = join(import.meta.dir, "..", "skills", "clear-communication", "SKILL.md");
const MAIN = join(import.meta.dir, "..", "skills", "main-workflow", "SKILL.md");
const TOOLS = join(import.meta.dir, "..", "skills", "omp-tools", "SKILL.md");
const CURSOR_TOOLS = `Tool names on the Cursor provider. Never call the native Cursor tools Glob and Grep, even though they are listed: they duplicate the MCP tools here. Search only with the MCP tools of server pi-agent:
- MCP glob finds files by name. Arguments: glob_pattern (required string, for example "**/currency_sync/**/*.rs" or "**/config.toml"; a pattern without a leading **/ matches at any depth) and optional target_directory (directory to search, default the working directory). It has no pattern, path or query argument.
- MCP rg searches file contents. Arguments: pattern (required regex string, for example "fn main|TARGETS"), optional path (file or directory), glob (file name filter such as "*.rs"), type (rust, py, ts, js, md, json, yaml, toml, sh and others), output_mode ("content", "files_with_matches" or "count"), "-i" (boolean, case insensitive), "-A", "-B", "-C" (numbers of context lines), head_limit and offset (numbers), multiline (boolean).
Pass every argument with exactly these names and types. Your native Read, Shell, StrReplace, Write, Delete and TodoWrite are the omp tools these instructions call read, bash, edit, write, delete and todo: use the native tools for them. Read also accepts omp selectors in the path, such as file:raw:N+K and file:<line>:chars:<start>+<count>. Call the other omp tools, such as task, goal, progress, eval and lsp, as MCP tools of pi-agent. Use the MCP task for subagents and the MCP goal for goals: the native Task, AskQuestion and SwitchMode are rejected here, and the native goal tools of Cursor are not the omp goal. Here Read returns plain file lines that the Cursor server numbers itself, so the omp read markers do not appear; a Read cut by the output budget still ends with [Use offset=N to continue], and a line too long for the output ends with [Use path=<file>:<line>:chars:<start>+<count> to continue]. This mapping is complete; do not compare the tool lists.`;
export default function harness(pi: ExtensionAPI) {
	const z = pi.zod;
	const PROGRESS = "my-omp-harness.progress";
	let progressItem: string | undefined;

	// Root Main keeps omp's goal tool, which omp removes when a goal completes or is dropped; subagents get no progress or tospec tools.
	const syncTools = async (kind: string) => {
		const active = await pi.getActiveTools();
		const next =
			kind === "sub"
				? active.filter(name => name !== "progress" && name !== "tospec")
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
			"Show the substeps of the in-progress todo item as a bar under the todo panel. item: the exact content of that todo item. steps: its substeps in order. current: the number of the current substep, from 1. Call it when the item starts and whenever the current substep changes; an empty steps list removes the bar. The bar disappears by itself when a todo update leaves the item not in progress.",
		parameters: z.object({ item: z.string(), steps: z.array(z.string()), current: z.number() }),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const total = params.steps.length;
			if (total === 0) {
				progressItem = undefined;
				ctx.ui.setWidget(PROGRESS, undefined);
				return { content: [{ type: "text", text: "Progress bar removed." }] };
			}
			const current = Math.min(Math.max(1, Math.round(params.current)), total);
			progressItem = params.item;
			const bar = params.steps.map((_step, index) => (index < current ? "▰" : "▱")).join("");
			ctx.ui.setWidget(PROGRESS, [`${bar} ${current}/${total} ${params.steps[current - 1]}`]);
			return { content: [{ type: "text", text: `Shown under the todo panel: substep ${current} of ${total}.` }] };
		},
	});
	// The bar belongs to one todo item and disappears once a todo update leaves that item not in progress.
	pi.on("tool_result", async (event, ctx) => {
		if (event.toolName !== "todo" || event.isError || progressItem === undefined) return;
		const phases = (event.details as { phases?: { tasks: { content: string; status: string }[] }[] } | undefined)?.phases ?? [];
		if (phases.some(phase => phase.tasks.some(task => task.status === "in_progress" && task.content === progressItem))) return;
		progressItem = undefined;
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
			if (isKeyRelease(data) || !matchesKey(data, "ctrl+shift+p") || goalState === "none" || ctx.ui.getEditorText() !== "") return undefined;
			ctx.ui.setEditorText(goalState === "active" ? "/goal pause" : "/goal resume");
			return { data: "\r" };
		});
	};
	pi.on("session_start", (_event, ctx) => bindPauseKey(ctx));
	pi.on("session_switch", (_event, ctx) => bindPauseKey(ctx));
	pi.on("goal_updated", event => {
		const status = event.goal?.status;
		goalState = status === "active" ? "active" : status === "paused" ? "paused" : "none";
	});

	pi.on("before_agent_start", async (event, ctx) => {
		const tools = `Apply the following omp tool mechanics to every tool call. Source: ${TOOLS}\n\n${readFileSync(TOOLS, "utf8")}`;
		const cursor = ctx.model?.provider === "cursor" ? [CURSOR_TOOLS] : [];
		// A subagent works from its definition and brief: drop block 0 (SYSTEM.md and the skill list) and add only the tool mechanics.
		if (ctx.agent.kind === "sub") return { systemPrompt: [...event.systemPrompt.slice(1), tools] };
		return {
			systemPrompt: [
				...event.systemPrompt,
				`Apply the full Gold Standard to all work. Apply silently. Source: ${GOLD}\n\n${readFileSync(GOLD, "utf8")}`,
				tools,
				...cursor,
				`Apply the following root Main workflow for plan mode, todo, progress and the goal. Source: ${MAIN}\n\n${readFileSync(MAIN, "utf8")}`,
				`Apply the following communication skill before every user-facing message. Source: ${COMM}\n\n${readFileSync(COMM, "utf8")}`,
			],
		};
	});
}
