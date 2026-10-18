import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { launch, loadRole, runTask, started } from "../../shared/subagents.ts";
import description from "./description.md" with { type: "text" };

const ROLE = loadRole("custom");

export default function custom(pi: ExtensionAPI) {
	const z = pi.zod;
	pi.registerTool({
		name: "custom",
		label: "custom",
		loadMode: "essential",
		concurrency: "shared",
		description: description.trim(),
		parameters: z.object({
			model: z.string(),
			effort: z.enum(["off", "minimal", "low", "medium", "high", "xhigh", "max"]).optional(),
			task: z.string(),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const spec = { role: ROLE, model: params.model, thinking: params.effort ?? "inherit" };
			return started(launch(pi, "custom", () => runTask(spec, params.task, ctx)));
		},
	});
}
