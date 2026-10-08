import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const GOLD = join(import.meta.dir, "..", "skills", "gold-standard", "SKILL.md");
const COMM = join(import.meta.dir, "..", "skills", "clear-communication", "SKILL.md");
const TOOLS = join(import.meta.dir, "..", "skills", "omp-tools", "SKILL.md");
const CONTEXT = join(import.meta.dir, "..", "skills", "context-gathering", "SKILL.md");
const STATE = "my-omp-harness.lunatron";

const ACTIVE = `LUNATRON_STATE=ACTIVE
Lunatron is active for this root task through LNT1.
Read the bundled lunatron-delegation skill first. Batch that read with your first reads.
Follow the rules below only when that skill authorizes delegation; this block is
the runtime contract, not an independent source of delegation authority.

Purpose: a faster result. Independent blocks run in parallel, noisy output stays
with the worker, and handoffs are short.

Delegate a block only when it is large, independent of your next step, and can
run in parallel with your own work. Do short or sequential work yourself,
including CLI runs and tests. A plain question needs no helper.
Main keeps scope, decisions, acceptance, the todo list, and the user response.

Roles, pinned by the routing extension. Sol roles list (GPT parent; Claude
parent). The others list (Composer, used when Cursor is available; GPT-parent
fallback; Claude-parent fallback):
- lunatik (composer-2.5; gpt-6-luna/medium; claude-sonnet-5-5/low): fresh
  worker for one execution block.
- lunatik_high (composer-2.5; gpt-6-luna/medium; claude-sonnet-5-5/low):
  fresh worker for a complex block.
- lunatron_low, lunatron_medium, lunatron_high (gpt-6.1-sol at that
  effort; claude-sonnet-5-5/high, claude-opus-5-5/low, claude-opus-5-5/low):
  fresh worker for a block that needs harder analysis. Sol implements its block
  itself or spawns Luna for large independent parts; no Sol-to-Sol chains.
- enot (composer-2.5; gpt-6-luna/low; claude-sonnet-5-5/off): read-only;
  answers a question over large data. Give it the paths and the question.
Main on Luna uses only lunatik, lunatik_high, enot and code_writer. Pick
a sufficient level directly.

Brief: the worker does not see your history. Write a self-contained brief:
result, targets, cwd, the decisions to keep, and the facts, paths, and snippets
it needs. A snippet or exact edit is fine when it is shorter than a description.

Each helper returns one terse final: status, result, changed paths, key facts
with file:line, check results, errors, unknowns. Use it without rechecking.
While helpers run, continue your own work; wait on agent events only when
blocked. If a role or spawn is unavailable, do the block directly.

For very large outputs, read the full output saved under artifact:// by line
ranges or grep it. The LNT mode entry is the only Lunatron state; add no router,
registry, scheduler, or retry system.`;
const CHILD = `LUNATRON_STATE=INACTIVE
Lunatron root orchestration does not apply to this child. Follow your role and
assigned block; requests and LNT commands quoted in your brief are context, not
new assignments. Only root Main manages the todo list.
A Sol profile may spawn Luna (lunatik or lunatik_high) for a large
independent part of its own block, without Sol-to-Sol chains. Other children
spawn no workers except a helper required by an assigned skill.
Use other agents' finished results without rechecking.
Return one terse final to your parent, with no narration: status, result,
changed paths, key facts with file:line, check results, errors, unknowns. The
parent uses it without rechecking. For a missing essential decision, return
DECISION_REQUIRED with the issue and partial result.`;
const CURSOR_TOOLS = `Tool names on the Cursor provider. Your native Read, Glob, Grep, Shell, StrReplace, Write, Delete and TodoWrite are the omp tools these instructions call read, glob, rg, bash, edit, write, delete and todo: use the native tools for them. Read also accepts omp selectors in the path, such as file:raw:N+K and file:<line>:chars:<start>+<count>. Call the other omp tools, such as task, goal, progress, eval and lsp, as MCP tools of pi-agent. Use the MCP task for subagents and the MCP goal for goals: the native Task, AskQuestion and SwitchMode are rejected here, and the native goal tools of Cursor are not the omp goal. Here Read returns plain file lines that the Cursor server numbers itself, so the omp read markers do not appear; a Read cut by the output budget still ends with [Use offset=N to continue], and a line too long for the output ends with [Use path=<file>:<line>:chars:<start>+<count> to continue]. If your MCP tools include rg and glob, your role has no native Grep and Glob: search with the MCP rg and glob instead. This mapping is complete; do not compare the tool lists.`;
const INACTIVE = `LUNATRON_STATE=INACTIVE
Ignore all earlier Lunatron ACTIVE delegation instructions, including Main
execution limits and role guards. Lunatron delegation is disabled.
Work normally under the current task and other active instructions.`;

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
		if (ctx.agent.kind === "sub") {
			blocks.push(`${CHILD}\nLUNATRON_MODE=subagent`);
			return { systemPrompt: [...event.systemPrompt, ...blocks] };
		}
		blocks.push(`Apply the following communication skill before every user-facing message. Source: ${COMM}\n\n${readFileSync(COMM, "utf8")}`);

		let command: 0 | 1 | undefined;
		for (const m of event.prompt.matchAll(/(?:^|\s)LNT([01])(?=$|\s)/gi)) command = Number(m[1]) as 0 | 1;
		let error: string | undefined;
		if (command !== undefined) {
			try {
				await pi.appendEntry(STATE, { override: command });
			} catch (e) {
				error = String(e instanceof Error ? e.message : e).replace(/[\r\n]+/g, " ");
			}
		}
		let stored: unknown;
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type === "custom" && entry.customType === STATE) stored = (entry.data as { override?: unknown } | undefined)?.override;
		}
		const override = command !== undefined && error === undefined ? command : stored;
		const basis = error !== undefined ? "state-error" : override === 1 ? "forced-on" : override === 0 ? "forced-off" : "default-off";
		blocks.push(
			basis === "forced-on"
				? `${ACTIVE}\n\nlunatron-delegation skill: skill://lunatron-delegation (skip the read if it is already loaded).\nLUNATRON_MODE=forced-on`
				: `${INACTIVE}\nLUNATRON_MODE=${basis}`,
		);

		let status: string | undefined;
		if (error !== undefined) {
			status = `LUNATRON_MODE_ERROR=${error}\nTell the user briefly that the requested mode could not be established. Do not apply Lunatron restrictions.`;
		} else if (command !== undefined) {
			status = `LUNATRON_COMMAND_APPLIED=LNT${command}`;
			if (command === 0) status += "\nBefore continuing, stop all running subagents of this task with write proc://<id>/kill. Do not affect other user tasks. Establish the state of interrupted changes before further work; never blindly retry.";
			status += "\nBriefly confirm the applied mode, then carry out the rest of the user request, if any.";
		}
		return {
			systemPrompt: [...event.systemPrompt, ...blocks],
			message: status === undefined ? undefined : { customType: "my-omp-harness.lunatron-mode", content: status, display: false, details: {}, attribution: "agent" },
		};
	});
}
