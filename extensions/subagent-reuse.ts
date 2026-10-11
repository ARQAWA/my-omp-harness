// A `[task <id>#<n>]` IRC message from Main starts a new task in a reused subagent,
// so everything before it is hidden from the model. Only the messages sent to the LLM
// are cut; the session file and in-memory session stay untouched.
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { updateAgentTask } from "./cursor-feed/agent-tasks";

export default function subagentReuse(pi: ExtensionAPI) {
	pi.on("context", (event, ctx) => {
		if (ctx.agent.kind !== "sub") return undefined;
		noteTask(ctx);
		const messages = event.messages;
		for (let i = messages.length - 1; i >= 0; i--) {
			const m = messages[i];
			if (m.role !== "custom" || m.customType !== "irc:incoming") continue;
			const details = m.details as { fromParent?: unknown; message?: unknown } | undefined;
			const body = details?.message;
			if (details?.fromParent !== true || typeof body !== "string") continue;
			if (!/^\[task [^\]\s]+#\d+\]/.test(body.trimStart())) continue;
			return { messages: messages.slice(i) };
		}
		return undefined;
	});
	pi.on("message_end", (_event, ctx) => {
		if (ctx.agent.kind === "sub") noteTask(ctx);
	});
	pi.on("agent_end", (_event, ctx) => {
		if (ctx.agent.kind === "sub") noteTask(ctx);
	});
}

/** Keeps the task metrics of a sub-agent current; a failed measure leaves the last one in place. */
function noteTask(ctx: { agent: { id: string }; sessionManager: { getBranch(): readonly unknown[] } }): void {
	try {
		updateAgentTask(ctx.agent.id, ctx.sessionManager.getBranch());
	} catch {
		// The hub keeps showing the last measured task.
	}
}
