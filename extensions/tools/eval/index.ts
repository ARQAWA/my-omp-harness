import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { getEvalToolDescription } from "@oh-my-pi/pi-coding-agent/tools/eval";
import { nativeRenderers, unavailable } from "../../shared/native.ts";
import description from "./description.md" with { type: "text" };

export default function evalTool(pi: ExtensionAPI) {
	const z = pi.zod;
	pi.registerTool({
		name: "eval",
		label: "eval",
		// Loadable through load_tools (shared/toolset.ts); essential keeps omp from mounting it under xd:// as well.
		loadMode: "essential",
		approval: "exec",
		// One kernel per language holds the session state, so cells run one at a time.
		concurrency: "exclusive",
		// omp's own eval text, rendered without subagents and the wait tool, followed by this tool's rules.
		description: `${getEvalToolDescription({ spawns: false, waitTool: false, eagerDelegation: false })}\n${description.trim()}`,
		parameters: z.object({
			language: z.enum(["py", "js"]),
			code: z.string().describe("Code or standalone % command; top-level await works."),
			title: z.string().optional().describe("Short transcript label."),
			timeout: z.number().optional().describe("Cell deadline in seconds; 0 disables it."),
			reset: z.boolean().optional().describe("Wipe only this kernel."),
		}),
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			if (!ctx.invokeTool) return unavailable("eval");
			// Same name as the native tool, so invokeTool runs omp's eval.
			return ctx.invokeTool(params as Record<string, unknown>, { signal, onUpdate });
		},
		...nativeRenderers("eval"),
	});
}
