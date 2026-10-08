import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const GOLD = join(import.meta.dir, "..", "skills", "gold-standard", "SKILL.md");
const COMM = join(import.meta.dir, "..", "skills", "clear-communication", "SKILL.md");
const TOOLS = join(import.meta.dir, "..", "skills", "omp-tools", "SKILL.md");
const CONTEXT = join(import.meta.dir, "..", "skills", "context-gathering", "SKILL.md");
const CURSOR_TOOLS = `Tool names on the Cursor provider. Your native Read, Glob, Grep, Shell, StrReplace, Write, Delete and TodoWrite are the omp tools these instructions call read, glob, rg, bash, edit, write, delete and todo: use the native tools for them. Read also accepts omp selectors in the path, such as file:raw:N+K and file:<line>:chars:<start>+<count>. Call the other omp tools, such as task, goal, progress, eval and lsp, as MCP tools of pi-agent. Use the MCP task for subagents and the MCP goal for goals: the native Task, AskQuestion and SwitchMode are rejected here, and the native goal tools of Cursor are not the omp goal. Here Read returns plain file lines that the Cursor server numbers itself, so the omp read markers do not appear; a Read cut by the output budget still ends with [Use offset=N to continue], and a line too long for the output ends with [Use path=<file>:<line>:chars:<start>+<count> to continue]. If your MCP tools include rg and glob, your role has no native Grep and Glob: search with the MCP rg and glob instead. This mapping is complete; do not compare the tool lists.`;
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

	pi.on("before_agent_start", async (event, ctx) => {
		const blocks = [
			`Apply the full Gold Standard to all work. Apply silently. Source: ${GOLD}\n\n${readFileSync(GOLD, "utf8")}`,
			`Apply the following omp tool mechanics to every tool call. Source: ${TOOLS}\n\n${readFileSync(TOOLS, "utf8")}`,
			`Apply the following context-gathering cycle to every search and read. Source: ${CONTEXT}\n\n${readFileSync(CONTEXT, "utf8")}`,
		];
		if (ctx.model?.provider === "cursor") blocks.push(CURSOR_TOOLS);
		if (ctx.agent.kind !== "sub") blocks.push(`Apply the following communication skill before every user-facing message. Source: ${COMM}\n\n${readFileSync(COMM, "utf8")}`);
		return { systemPrompt: [...event.systemPrompt, ...blocks] };
	});
}
