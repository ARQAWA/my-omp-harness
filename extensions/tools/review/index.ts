import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { launch, loadRole, runTask, started } from "../../shared/subagents.ts";
import description from "./description.md" with { type: "text" };

const ROLE = loadRole("review");
// One prompt for every level; the level picks the model.
const LEVELS = {
	light: { model: "anthropic/claude-haiku-5-5", thinking: "low", fallback: { model: "openai-codex/gpt-6-sol", thinking: "medium" } },
	blind: { model: "anthropic/claude-haiku-5-5", thinking: "medium", fallback: { model: "openai-codex/gpt-6.1-sol", thinking: "low" } },
	high: { model: "anthropic/claude-sonnet-5-5", thinking: "low", fallback: { model: "openai-codex/gpt-6.1-sol", thinking: "medium" } },
} as const;

export default function review(pi: ExtensionAPI) {
	const z = pi.zod;
	pi.registerTool({
		name: "review",
		label: "review",
		loadMode: "essential",
		concurrency: "shared",
		description: description.trim(),
		parameters: z.object({
			level: z.enum(["light", "blind", "high"]),
			agreement: z.string(),
			object: z.string(),
			criterion: z.string(),
			rejected: z.string().optional(),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const brief = [
				`Agreement (verbatim):\n${params.agreement}`,
				`Object:\n${params.object}`,
				`Criterion: ${params.criterion}`,
				params.rejected ? `Rejected earlier:\n${params.rejected}` : "",
			].filter(Boolean);
			const spec = { role: ROLE, ...LEVELS[params.level] };
			return started(launch(pi, "review", () => runTask(spec, brief.join("\n\n"), ctx)));
		},
	});
}
