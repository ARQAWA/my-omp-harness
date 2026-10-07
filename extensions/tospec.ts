import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { getAgentDir, getMarkdownTheme } from "@oh-my-pi/pi-coding-agent";
import { Markdown, matchesKey, truncateToWidth, visibleWidth } from "@oh-my-pi/pi-tui";
import { MODELS } from "./model-arrows.js";
import { ORDER, levelsFor } from "./reasoning-arrows.js";
import { homedir } from "node:os";
import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

const STATE = "my-omp-harness.tospec";
const DIR = join(import.meta.dir, "tospec");
const PREP_FILES = [
	"basis.md",
	"01-research.md",
	"02-spec.md",
	"03-approve.md",
	"04-plan.md",
	"05-plan-check.md",
	"review.md",
	"spec-template.md",
	"plan-template.md",
];
const EXEC_FILES = ["basis.md", "06-execute.md", "review.md"];
const PREP_PHASE: Record<string, true> = { spec: true, plan: true, ready: true };
const LABEL: Record<string, string> = {
	spec: "ToSpec: spec",
	plan: "ToSpec: plan",
	ready: "ToSpec: ready",
	execute: "ToSpec: run",
};
const EXECUTOR = join(getAgentDir(), "my-omp-harness-tospec.json");

type Phase = "spec" | "plan" | "ready" | "launched" | "execute" | "done";

let phase: Phase | undefined;
let workspace: string | undefined;
let commandCtx: ExtensionContext | undefined;
let approvalPending = false;

function writable(target: string, ctx: { cwd: string }, content?: string): boolean {
	if (/^local:\/\//.test(target) || /^agent:\/\//.test(target) || /^proc:\/\//.test(target)) return true;
	if (target.startsWith("xd://ast_grep")) return true;
	if (target.startsWith("xd://lsp")) {
		if (!content) return true;
		try {
			const body = JSON.parse(content) as { action?: string; apply?: boolean };
			if (body.action === "rename" || body.action === "rename_file") return false;
			if (body.apply === true) return false;
			return true;
		} catch {
			return false;
		}
	}
	if (/^[a-z][a-z0-9+.-]*:\/\//i.test(target)) return false;
	if (!workspace) return false;
	const abs = resolve(ctx.cwd, target.startsWith("~/") ? join(homedir(), target.slice(2)) : target);
	const root = workspace.endsWith(sep) ? workspace : workspace + sep;
	return abs === workspace || abs.startsWith(root);
}

function fitLevel(level: string, model: { thinking?: { efforts?: string[] }; compat?: { supportsBetweenToolsThinking?: boolean } } | undefined): string {
	const levels = levelsFor(model);
	if (!levels.length) return level;
	if (levels.includes(level)) return level;
	const want = ORDER.indexOf(level);
	let best = levels[0];
	for (const item of levels) {
		if (ORDER.indexOf(item) <= want) best = item;
	}
	return best;
}

export default function tospec(pi: ExtensionAPI) {
	const z = pi.zod;

	const sync = (ctx: ExtensionContext) => {
		if (ctx.agent.kind !== "main") return;
		let nextPhase: Phase | undefined;
		let nextWorkspace: string | undefined;
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type === "custom" && entry.customType === STATE) {
				const data = entry.data as { phase?: Phase; workspace?: string } | undefined;
				nextPhase = data?.phase;
				nextWorkspace = data?.workspace;
			}
		}
		phase = nextPhase;
		workspace = nextWorkspace;
		if (ctx.hasUI) ctx.ui.setStatus("tospec", phase ? LABEL[phase] : undefined);
	};

	const save = async (next: Phase, ctx: ExtensionContext) => {
		await pi.appendEntry(STATE, { phase: next, workspace });
		phase = next;
		if (ctx.hasUI) ctx.ui.setStatus("tospec", LABEL[next]);
	};

	const block = (_ctx: ExtensionContext, files: string[]) => {
		const parts = [
			`ToSpec mode is active: phase ${phase}. Workspace: ${workspace}\nFollow the ToSpec process below. Source: ${DIR}`,
		];
		for (const name of files) parts.push(`----- ${name}\n${readFileSync(join(DIR, name), "utf8")}`);
		return parts.join("\n\n");
	};

	const openApproval = async (ctx: ExtensionContext) => {
		if (phase !== "ready" || !workspace) {
			ctx.ui.notify("ToSpec is not waiting for approval.", "info");
			return;
		}
		let text: string;
		try {
			text = `${readFileSync(join(workspace, "spec.md"), "utf8")}\n\n---\n\n${readFileSync(join(workspace, "plan.md"), "utf8")}`;
		} catch (e) {
			ctx.ui.notify(String(e instanceof Error ? e.message : e), "error");
			return;
		}
		const specs = MODELS.filter(s => ctx.models.list().some(m => `${m.provider}/${m.id}` === s));
		if (!specs.length) {
			ctx.ui.notify("ToSpec: no executor models are available.", "error");
			return;
		}
		let saved: { model?: string; level?: string } | undefined;
		try {
			saved = JSON.parse(readFileSync(EXECUTOR, "utf8")) as { model?: string; level?: string };
		} catch {
			saved = undefined;
		}
		let modelSpec = saved?.model && specs.includes(saved.model) ? saved.model : undefined;
		if (!modelSpec && ctx.model) {
			const cur = `${ctx.model.provider}/${ctx.model.id}`;
			if (specs.includes(cur)) modelSpec = cur;
		}
		if (!modelSpec) modelSpec = specs[0];
		let model = ctx.models.resolve(modelSpec);
		let level = saved?.level ?? pi.getThinkingLevel();
		level = fitLevel(level, model);
		let scroll = 0;
		let mdCache: { width: number; lines: string[] } | undefined;

		const choice = await ctx.ui.custom<{ model: string; level: string } | undefined>(
			(tui, theme, _kb, done) => {
				const view = {
					render(width: number) {
						const bodyHeight = Math.max(5, (process.stdout.rows || 24) - 8);
						if (!mdCache || mdCache.width !== width) {
							mdCache = { width, lines: new Markdown(text, 1, 0, getMarkdownTheme()).render(width) };
						}
						const maxScroll = Math.max(0, mdCache.lines.length - bodyHeight);
						scroll = Math.min(scroll, maxScroll);
						const visible = mdCache.lines.slice(scroll, scroll + bodyHeight);
						const spec = modelSpec!;
						const resolved = ctx.models.resolve(spec);
						const levelLabel = level === "off" ? "no reasoning" : level;
						const fitWidth = (line: string) => {
							const w = visibleWidth(line);
							return w >= width ? truncateToWidth(line, width) : line + " ".repeat(width - w);
						};
						return [
							fitWidth(theme.fg("accent", "ToSpec: spec and plan")),
							...visible.map(fitWidth),
							fitWidth(""),
							fitWidth(`Executor: ${resolved?.name ?? spec} · ${levelLabel}`),
							fitWidth(
								theme.fg(
									"dim",
									"↑↓ model  ←→ reasoning  PgUp/PgDn scroll  Enter launch in a new chat  Esc close",
								),
							),
						];
					},
					handleInput(data: string) {
						const bumpModel = (dir: number) => {
							const index = specs.indexOf(modelSpec!);
							const next = index < 0
								? (dir < 0 ? specs.length - 1 : 0)
								: Math.min(specs.length - 1, Math.max(0, index + dir));
							modelSpec = specs[next];
							model = ctx.models.resolve(modelSpec);
							level = fitLevel(level, model);
						};
						const bumpLevel = (dir: number) => {
							const levels = levelsFor(model);
							if (!levels.length) return;
							const current = ORDER.indexOf(level);
							const next =
								dir > 0
									? levels.find(item => ORDER.indexOf(item) > current) ?? levels.at(-1)!
									: levels.findLast(item => ORDER.indexOf(item) < current) ?? levels[0]!;
							level = next;
						};
						if (matchesKey(data, "escape")) {
							done(undefined);
							return;
						}
						if (matchesKey(data, "enter")) {
							done({ model: modelSpec!, level });
							return;
						}
						if (matchesKey(data, "up") || matchesKey(data, "ctrl+up")) {
							bumpModel(-1);
						} else if (matchesKey(data, "down") || matchesKey(data, "ctrl+down")) {
							bumpModel(1);
						} else if (matchesKey(data, "left") || matchesKey(data, "ctrl+left")) {
							bumpLevel(-1);
						} else if (matchesKey(data, "right") || matchesKey(data, "ctrl+right")) {
							bumpLevel(1);
						} else if (matchesKey(data, "pageUp")) {
							scroll = Math.max(0, scroll - 3);
						} else if (matchesKey(data, "pageDown")) {
							const bodyHeight = Math.max(5, (process.stdout.rows || 24) - 8);
							const maxScroll = Math.max(0, (mdCache?.lines.length ?? 0) - bodyHeight);
							scroll = Math.min(maxScroll, scroll + 3);
						} else if (matchesKey(data, "home")) {
							scroll = 0;
						} else if (matchesKey(data, "end")) {
							const bodyHeight = Math.max(5, (process.stdout.rows || 24) - 8);
							scroll = Math.max(0, (mdCache?.lines.length ?? 0) - bodyHeight);
						} else {
							return;
						}
						tui.requestRender();
					},
					invalidate() {
						mdCache = undefined;
					},
				};
				return view;
			},
			{ overlay: true },
		);

		if (!choice) return;

		const executorModel = ctx.models.resolve(choice.model);
		if (!executorModel) {
			ctx.ui.notify(`ToSpec: could not resolve ${choice.model}.`, "error");
			return;
		}
		writeFileSync(EXECUTOR, JSON.stringify(choice));
		const ws = workspace;
		const start = `Execute the approved ToSpec plan. spec.md: ${join(ws, "spec.md")}; plan.md: ${join(ws, "plan.md")}.`;
		await save("launched", ctx);
		await ctx.waitForIdle();
		try {
			const r = await ctx.newSession({
				setup: async sm => {
					sm.appendCustomEntry(STATE, { phase: "execute", workspace: ws });
				},
			});
			if (r?.cancelled) {
				await save("ready", ctx);
				ctx.ui.notify("ToSpec launch was cancelled. Run /tospec to open the window again.", "info");
				return;
			}
		} catch {
			await save("ready", ctx);
			ctx.ui.notify("ToSpec launch was cancelled. Run /tospec to open the window again.", "info");
			return;
		}
		phase = "execute";
		if (ctx.hasUI) ctx.ui.setStatus("tospec", LABEL.execute);
		const switched = await pi.setModel(executorModel);
		if (!switched) {
			ctx.ui.notify(
				`ToSpec: could not switch to ${choice.model}. Choose the executor with ctrl+↑/↓ and ctrl+←/→, then send the prepared message.`,
				"info",
			);
			ctx.ui.setEditorText(start);
			return;
		}
		if (levelsFor(executorModel).length) pi.setThinkingLevel(choice.level);
		pi.sendUserMessage(start);
	};

	pi.on("session_start", (_event, ctx) => sync(ctx));
	pi.on("session_switch", (_event, ctx) => sync(ctx));

	pi.on("tool_call", (event, ctx) => {
		if (!phase || !PREP_PHASE[phase]) return;
		const prepReason = `ToSpec ${phase} phase: only the workspace ${workspace} and local:// are writable.`;
		const input = event.input as { path?: string; input?: string; content?: string };
		if (event.toolName === "write" && input.path && !writable(input.path, ctx, input.content)) {
			return { block: true, reason: prepReason };
		}
		if (event.toolName === "edit") {
			const paths: string[] = [];
			if (input.path) paths.push(input.path);
			if (input.input) {
				for (const line of input.input.split("\n")) {
					const head = line.match(/^\[(.+)#[0-9A-Fa-f]{4}\]\s*$/);
					const mv = line.match(/^MV\s+(.+)$/);
					if (head) paths.push(head[1]);
					if (mv) paths.push(mv[1]);
				}
			}
			if (!paths.length || paths.some(path => !writable(path, ctx))) {
				return { block: true, reason: prepReason };
			}
		}
		if (event.toolName === "ast_edit") {
			return { block: true, reason: prepReason };
		}
	});

	pi.on("before_agent_start", (event, ctx) => {
		if (ctx.agent.kind !== "main") return;
		sync(ctx);
		if (phase && PREP_PHASE[phase]) return { systemPrompt: [...event.systemPrompt, block(ctx, PREP_FILES)] };
		if (phase === "execute") return { systemPrompt: [...event.systemPrompt, block(ctx, EXEC_FILES)] };
	});

	pi.on("agent_end", (_event, ctx) => {
		if (ctx.agent.kind !== "main") return;
		sync(ctx);
		if (!approvalPending || phase !== "ready") return;
		approvalPending = false;
		if (commandCtx) {
			setTimeout(() => openApproval(commandCtx!).catch(e => commandCtx!.ui.notify(String(e), "error")), 0);
		} else {
			ctx.ui.notify("ToSpec plan is ready: run /tospec to review and launch it.", "info");
		}
	});

	pi.registerCommand("tospec", {
		description: "ToSpec: research, spec and plan; approve and launch in a new chat",
		handler: async (args, ctx) => {
			commandCtx = ctx;
			sync(ctx);
			const task = args.trim();
			if (task === "off") {
				if (phase && phase !== "launched" && phase !== "done") {
					await save("done", ctx);
					ctx.ui.notify(`ToSpec is off. The workspace stays at ${workspace}.`, "info");
				} else {
					ctx.ui.notify("No active ToSpec.", "info");
				}
				return;
			}
			if (!task) {
				if (phase === "ready") {
					void openApproval(ctx);
					return;
				}
				if (phase && phase !== "done") {
					ctx.ui.notify(LABEL[phase] ?? `ToSpec phase: ${phase}`, "info");
					return;
				}
				if (phase === "launched") {
					ctx.ui.notify("This ToSpec was launched in a new chat.", "info");
					return;
				}
				ctx.ui.notify("Usage: /tospec <task>", "info");
				return;
			}
			await ctx.waitForIdle();
			workspace = mkdtempSync(join(realpathSync(tmpdir()), "scope-focus-tospec-"));
			await save("spec", ctx);
			pi.sendUserMessage(`ToSpec task: ${task}`);
		},
	});

	pi.registerTool({
		name: "tospec",
		label: "ToSpec",
		loadMode: "essential",
		description:
			"Move the active ToSpec to its next phase. step plan: after the user accepted the whole spec through ask; lowers reasoning one level for the plan and tasks. step ready: after the Smarty CLEAN and READY FOR IMPLEMENTATION in plan.md; then end the turn, and the approval window opens. step done: in the execution chat, after the Bossy CLEAN, together with the final report.",
		parameters: z.object({ step: z.enum(["plan", "ready", "done"]) }),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			sync(ctx);
			if (params.step === "plan") {
				if (phase !== "spec") {
					return { content: [{ type: "text", text: `Step plan is not available in phase ${phase ?? "none"}.` }] };
				}
				const levels = levelsFor(ctx.model).filter(level => level !== "off");
				const cur = pi.getThinkingLevel();
				const lower = levels.filter(level => ORDER.indexOf(level) < ORDER.indexOf(cur)).at(-1);
				if (lower) pi.setThinkingLevel(lower);
				await save("plan", ctx);
				return {
					content: [
						{
							type: "text",
							text: `Phase plan. Reasoning: ${cur} → ${lower ?? cur}. Write plan.md (04) and run the Smarty check (05).`,
						},
					],
				};
			}
			if (params.step === "ready") {
				if (phase !== "plan" && phase !== "ready") {
					return { content: [{ type: "text", text: `Step ready is not available in phase ${phase ?? "none"}.` }] };
				}
				if (!workspace || !existsSync(join(workspace, "spec.md")) || !existsSync(join(workspace, "plan.md"))) {
					const missing = !workspace
						? "workspace"
						: !existsSync(join(workspace, "spec.md"))
							? join(workspace, "spec.md")
							: join(workspace, "plan.md");
					return { content: [{ type: "text", text: `ToSpec ready requires spec.md and plan.md in the workspace. Missing: ${missing}` }] };
				}
				await save("ready", ctx);
				approvalPending = true;
				return {
					content: [
						{
							type: "text",
							text: "Phase ready. End your turn now with one short line; the approval window opens when the turn ends.",
						},
					],
				};
			}
			if (params.step === "done") {
				if (phase !== "execute") {
					return { content: [{ type: "text", text: `Step done is not available in phase ${phase ?? "none"}.` }] };
				}
				await save("done", ctx);
				return { content: [{ type: "text", text: "ToSpec finished." }] };
			}
			return { content: [{ type: "text", text: `Step ${params.step} is not available in phase ${phase ?? "none"}.` }] };
		},
	});
}
