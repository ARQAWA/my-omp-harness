import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { launch, loadRole, runTask, started } from "../../shared/subagents.ts";
import description from "./description.md" with { type: "text" };

// Model "" runs the explorer on Main's model.
const SPEC = { role: loadRole("explore"), model: "", thinking: "medium" };

export default function explore(pi: ExtensionAPI) {
	const z = pi.zod;
	pi.registerTool({
		name: "explore",
		label: "explore",
		loadMode: "essential",
		concurrency: "shared",
		description: description.trim(),
		parameters: z.object({
			question: z.string(),
			thoroughness: z.enum(["quick", "medium", "very thorough"]),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const brief = `Thoroughness: ${params.thoroughness}\n\n${params.question}`;
			return started(launch(pi, "explore", () => runTask(SPEC, brief, ctx)));
		},
	});
}
