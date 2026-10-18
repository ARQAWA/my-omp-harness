import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { unavailable } from "../../shared/native.ts";
import description from "./description.md" with { type: "text" };

// One call launches one subagent on omp's native task. Not registered in package.json yet: subagents are the next stage.
export default function task(pi: ExtensionAPI) {
	const z = pi.zod;
	pi.registerTool({
		name: "task",
		label: "Task",
		loadMode: "essential",
		approval: "exec",
		concurrency: "shared",
		description: description.trim(),
		parameters: z.object({
			description: z.string(),
			prompt: z.string(),
			subagent_type: z.enum(["generalPurpose", "explore"]).optional(),
		}),
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			if (!ctx.invokeTool) return unavailable("task");
			return ctx.invokeTool(
				{ context: params.description, tasks: [{ agent: params.subagent_type ?? "generalPurpose", task: params.prompt, solutionSpace: "open" }] },
				{ signal, onUpdate },
			);
		},
	});
}
