import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { collectAtStop, disposeAll, loadRole, prestart } from "./shared/subagents.ts";

// Warm sessions started with Main: one per role target, so the first launch of each skips session setup.
const WARM = [
	{ role: "code_writer", model: "anthropic/claude-haiku-5-5", thinking: "medium" },
	{ role: "shell_runner", model: "anthropic/claude-haiku-5-5", thinking: "medium" },
	{ role: "codebase_explorer", model: "anthropic/claude-haiku-5-5", thinking: "high" },
];

const REVIEWS = { lightreview: "light", blindreview: "blind", highreview: "high" } as const;

export default function subagents(pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		if (ctx.agent.kind !== "main") return;
		// OMPLITE_WARM=off skips warm sessions, to measure their startup cost.
		if (process.env.OMPLITE_WARM === "off") return;
		for (const target of WARM) {
			if (process.env.OMPLITE_EXPLORER === "off" && target.role === "codebase_explorer") continue;
			prestart({ role: loadRole(target.role), model: target.model, thinking: target.thinking }, ctx);
		}
	});

	// Main does not finish while a subagent it launched is still running: it waits for the next final and continues with it.
	pi.on("session_stop", async (_event, ctx) => {
		if (ctx.agent.kind !== "main") return undefined;
		const finals = await collectAtStop();
		if (finals.length === 0) return undefined;
		return { continue: true, additionalContext: finals.join("\n\n") };
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		if (ctx.agent.kind === "main") await disposeAll();
	});

	for (const [command, level] of Object.entries(REVIEWS)) {
		pi.registerCommand(command, {
			description: `Run a ${level} review of the current work`,
			handler: async args => {
				const extra = args.trim() ? ` ${args.trim()}` : "";
				pi.sendUserMessage(`Run a ${level} review of the current work with the review tool, level ${level}.${extra}`);
			},
		});
	}
}
