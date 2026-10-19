import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { cwdLine, fileBlocks, launch, loadRole, runTask, started } from "../../shared/subagents.ts";
import description from "./description.md" with { type: "text" };
import { todoParameters } from "../../shared/todo-ops.ts";

const SPEC = { role: loadRole("code_writer"), model: "anthropic/claude-haiku-5-5", thinking: "medium" };

export default function codeWriter(pi: ExtensionAPI) {
	const z = pi.zod;
	const parameters = todoParameters(pi, extra => z.object({
		goal: z.string(),
		files: z.array(z.string()),
		decisions: z.string().optional(),
		facts: z.string().optional(),
		check: z.string().optional(),
		cwd: z.string().optional(),
		...extra,
	}));
	pi.registerTool({
		name: "code_writer",
		label: "code_writer",
		loadMode: "essential",
		concurrency: "shared",
		description: description.trim(),
		get parameters() {
			return parameters();
		},
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const cwd = params.cwd || ctx.cwd;
			const id = launch(pi, "code_writer", async () => {
				const brief = [
					`Result: ${params.goal}`,
					cwdLine(cwd, ctx),
					params.decisions ? `Decisions to keep: ${params.decisions}` : "",
					params.facts ? `Facts: ${params.facts}` : "",
					`Check: ${params.check || "none"}`,
					"Files, with their current content (already read; do not read them again):",
					await fileBlocks(params.files, cwd),
				].filter(Boolean);
				return runTask(SPEC, brief.join("\n"), ctx);
			});
			return started(id);
		},
	});
}
