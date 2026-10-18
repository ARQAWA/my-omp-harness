import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { type Component, Text } from "@oh-my-pi/pi-tui";
import { type ToolRenderer, toolRenderers } from "@oh-my-pi/pi-tui/tools";
import { getEvalToolDescription } from "@oh-my-pi/pi-coding-agent/tools/eval";

// omp's own eval text for omp-lite: no subagents and no wait tool.
const DESCRIPTION =
	`${getEvalToolDescription({ spawns: false, waitTool: false, eagerDelegation: false })}\n` +
	"Never use eval to search or read code while gathering context; grep, glob and read do that in parallel. Use eval for computation, data processing, or many tool calls whose output must be filtered in code. An eval call runs alone: it waits for the calls before it and holds back the calls after it.";

export default function evalTool(pi: ExtensionAPI) {
	const z = pi.zod;
	pi.registerTool({
		name: "eval",
		label: "eval",
		loadMode: "essential",
		approval: "exec",
		concurrency: "exclusive",
		description: DESCRIPTION,
		parameters: z.object({
			language: z.enum(["py", "js"]),
			code: z.string().describe("Code or standalone % command; top-level await works."),
			title: z.string().optional().describe("Short transcript label."),
			timeout: z.number().optional().describe("Cell deadline in seconds; 0 disables it."),
			reset: z.boolean().optional().describe("Wipe only this kernel."),
		}),
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			if (!ctx.invokeTool) {
				return { content: [{ type: "text" as const, text: "eval is not available to this agent." }], isError: true };
			}
			// Same name as the built-in, so invokeTool runs omp's native eval.
			return ctx.invokeTool(params as Record<string, unknown>, { signal, onUpdate });
		},
		renderCall: (...args: Parameters<ToolRenderer["renderCall"]>): Component => {
			const host = toolRenderers["eval"];
			return host ? (host.renderCall(...args) as Component) : new Text("eval", 0, 0);
		},
		renderResult: (...args: Parameters<ToolRenderer["renderResult"]>): Component => {
			const host = toolRenderers["eval"];
			return host ? (host.renderResult(...args) as Component) : new Text("eval", 0, 0);
		},
	});
}
