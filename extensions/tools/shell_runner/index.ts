import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { cwdLine, launch, loadRole, runTask, started } from "../../shared/subagents.ts";
import description from "./description.md" with { type: "text" };
import { todoParameters } from "../../shared/todo-ops.ts";

const SPEC = { role: loadRole("shell_runner"), model: "anthropic/claude-haiku-5-5", thinking: "medium" };

export default function shellRunner(pi: ExtensionAPI) {
	const z = pi.zod;
	const parameters = todoParameters(pi, extra => z.object({
		commands: z.string(),
		on_fail: z.enum(["stop", "continue"]),
		report: z.string(),
		cwd: z.string().optional(),
		...extra,
	}));
	pi.registerTool({
		name: "shell_runner",
		label: "shell_runner",
		loadMode: "essential",
		concurrency: "shared",
		description: description.trim(),
		get parameters() {
			return parameters();
		},
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const brief = `${cwdLine(params.cwd || ctx.cwd, ctx)}\nCommands:\n${params.commands}\nOn a failure: ${params.on_fail}.\nReport: ${params.report}`;
			return started(launch(pi, "shell_runner", () => runTask(SPEC, brief, ctx)));
		},
	});
}
