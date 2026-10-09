import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

// Sets the default model on a fresh top-level session; sessions with history and explicit model flags keep theirs.
const LONG_FLAGS = ["--model", "--models", "--thinking", "--provider", "--continue", "--resume", "--session"];
const SHORT_FLAGS = ["-c", "-r"];

function hasModelFlag(argv: readonly string[]): boolean {
	return argv.some(
		arg =>
			SHORT_FLAGS.includes(arg) ||
			LONG_FLAGS.some(flag => arg === flag || arg.startsWith(`${flag}=`)),
	);
}

export default function defaultModel(pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		if (ctx.agent.kind !== "main") return;
		if (hasModelFlag(process.argv)) return;
		if (ctx.sessionManager.getEntries().some(entry => entry.type === "message")) return;
		const model = ctx.models.resolve("anthropic/claude-opus-5-5");
		if (!model) return;
		await pi.setModel(model);
		pi.setThinkingLevel("medium");
	});
}
