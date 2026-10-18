import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { launch, loadRole, parentTarget, runTask, started } from "../../shared/subagents.ts";
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
			return started(launch(pi, "codebase_explorer", () => runTask(spec, brief, ctx)));
		},
	});
}
