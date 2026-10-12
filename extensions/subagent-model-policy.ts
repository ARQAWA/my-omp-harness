import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { lookup } from "@oh-my-pi/pi-coding-agent/config/registry";
import { type Component, Text } from "@oh-my-pi/pi-tui";
import { type ToolRenderer, toolRenderers } from "@oh-my-pi/pi-tui/tools";

const DESCRIPTION =
	"Launch harness subagents. Give `context`, shared by every item, and `tasks`: one item per subagent with `agent`, `task` (the agent's whole brief), `solutionSpace` (how open the problem is: whether the fix is given or which causes or designs stay open) and optional `name` (CamelCase; it becomes the agent id), `outputSchema`, `schemaMode` and `tools` (eval-defined tools run in your kernel). Use only the agent types from your subagent rules; the harness sets each one's model. `model` and `effort` are only for `agent: \"custom\"` and only when the user directly told you to run a subagent on a model he named: `model` is `provider/model` from the available models, `effort` is one of off, minimal, low, medium, high, xhigh, max and is given only when the user named a level. At most one custom item per call. The call returns the agent ids at once; each result arrives by itself, and `agent://<id>` holds an agent's output.";

const NAMED: Record<string, string> = {
	spotty: "anthropic/claude-haiku-5-5:low",
	smarty: "anthropic/claude-haiku-5-5:medium",
	bossy: "anthropic/claude-sonnet-5-5:low",
	code_writer: "anthropic/claude-haiku-5-5:high",
	shell_runner: "anthropic/claude-haiku-5-5:high",
};

const EFFORTS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

/**
 * The custom item whose spawn is next: its spec, and the release of the lock held by its task call.
 * The spawn of the custom subagent takes it and releases the lock; a failed task call clears it and releases the lock itself.
 */
let pending: { spec: string | undefined; release: () => void } | undefined;

/** Tail of the chain of task calls with a custom item; each such call waits for the previous one to reach its spawn or fail. */
let customChain: Promise<void> = Promise.resolve();

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

function errorResult(text: string) {
	return { content: [{ type: "text" as const, text }], isError: true };
}

export default function subagentModelPolicy(pi: ExtensionAPI) {
	const z = pi.zod;

	pi.on("session_start", (_event, ctx) => {
		if (ctx.agent.kind === "sub") lookup("retry.modelFallback")!.override(pi.pi.settings, false);
	});
	pi.on("before_subagent_spawn", event => {
		if (event.agent === "custom") {
			const entry = pending;
			pending = undefined;
			entry?.release();
			if (entry?.spec) return { model: entry.spec, note: `custom: ${entry.spec}` };
			return undefined;
		}
		if (Object.hasOwn(NAMED, event.agent)) {
			return { model: NAMED[event.agent], note: event.agent };
		}
		return undefined;
	});

	pi.registerTool({
		name: "task",
		label: "Task",
		loadMode: "essential",
		approval: "exec",
		strict: false,
		description: DESCRIPTION,
		parameters: z.object({
			context: z.string(),
			tasks: z.array(
				z.object({
					name: z.string().optional(),
					agent: z.string(),
					task: z.string(),
					solutionSpace: z.string(),
					outputSchema: z.union([z.object({}).passthrough(), z.boolean(), z.string(), z.null()]).optional(),
					schemaMode: z.enum(["permissive", "strict"]).optional(),
					tools: z.array(z.string()).optional(),
					model: z.string().optional(),
					effort: z.enum(EFFORTS).optional(),
				}),
			),
		}),
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			if (!ctx.invokeTool) {
				return errorResult("task is not available to this agent.");
			}
			const invokeTool = ctx.invokeTool;

			if (params.tasks.some(item => item.agent !== "custom" && (item.model !== undefined || item.effort !== undefined))) {
				return errorResult("model and effort are only for agent custom.");
			}
			const customItems = params.tasks.filter(item => item.agent === "custom");
			if (customItems.length > 1) {
				return errorResult("Give at most one custom item per task call.");
			}

			let spec: string | undefined;
			const custom = customItems[0];
			if (custom) {
				if (custom.model !== undefined && ctx.models.resolve(custom.model) === undefined) {
					const available = ctx.models
						.list()
						.map(m => `${m.provider}/${m.id}`)
						.join(", ");
					return errorResult(`Unknown model ${custom.model}. Available: ${available}`);
				}
				let base = custom.model;
				if (base === undefined) {
					const current = ctx.models.current();
					if (current) base = `${current.provider}/${current.id}`;
				}
				spec = base === undefined ? undefined : custom.effort === undefined ? base : `${base}:${custom.effort}`;
			}

			const delegated = params.tasks.map(({ model: _model, effort: _effort, ...rest }) => rest);

			if (!custom) {
				return invokeTool({ context: params.context, tasks: delegated }, { signal, onUpdate });
			}

			const previous = customChain;
			let release!: () => void;
			customChain = new Promise<void>(resolve => {
				release = resolve;
			});
			await previous;

			const entry = { spec, release };
			pending = entry;
			const abandon = () => {
				if (pending === entry) {
					pending = undefined;
					entry.release();
				}
			};
			try {
				const result = await invokeTool({ context: params.context, tasks: delegated }, { signal, onUpdate });
				if (result.isError) abandon();
				return result;
			} catch (error) {
				abandon();
				throw error;
			}
		},
		renderCall: (...args: Parameters<ToolRenderer["renderCall"]>): Component => {
			const host = toolRenderers["task"];
			return host ? (host.renderCall(...args) as Component) : new Text("task", 0, 0);
		},
		renderResult: (...args: Parameters<ToolRenderer["renderResult"]>): Component => {
			const host = toolRenderers["task"];
			return host ? (host.renderResult(...args) as Component) : new Text(firstTextLine(args[0]), 0, 0);
		},
	});
}
