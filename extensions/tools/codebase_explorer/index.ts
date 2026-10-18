import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { loadRole, runTask } from "../../shared/subagents.ts";
import description from "./description.md" with { type: "text" };

const SPEC = { role: loadRole("codebase_explorer"), model: "anthropic/claude-haiku-5-5", thinking: "medium" };

export default function codebaseExplorer(pi: ExtensionAPI) {
	const z = pi.zod;
	pi.registerTool({
		name: "codebase_explorer",
		label: "codebase_explorer",
		loadMode: "essential",
		concurrency: "shared",
		description: description.trim(),
		parameters: z.object({
			question: z.string(),
			thoroughness: z.enum(["quick", "medium", "very thorough"]),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const brief = `Thoroughness: ${params.thoroughness}\n\n${params.question}`;
			const begin = Date.now();
			const r = await runTask(SPEC, brief, ctx);
			return { content: [{ type: "text" as const, text: r.text }], details: { model: r.model, thinking: r.thinking, seconds: Math.round((Date.now() - begin) / 1000) } };
		},
	});
}
