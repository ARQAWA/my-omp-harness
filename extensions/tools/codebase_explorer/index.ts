import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { loadRole, parentTarget, runTask } from "../../shared/subagents.ts";
import description from "./description.md" with { type: "text" };

const ROLE = loadRole("codebase_explorer");

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
			const spec = { role: ROLE, ...parentTarget(pi, ctx) };
			const begin = Date.now();
			const r = await runTask(spec, brief, ctx);
			return { content: [{ type: "text" as const, text: r.text }], details: { model: r.model, thinking: r.thinking, seconds: Math.round((Date.now() - begin) / 1000) } };
		},
	});
}
