// A `[task <id>#<n>]` IRC message from Main starts a new task in a reused subagent,
// so everything before it is hidden from the model. Only the messages sent to the LLM
// are cut; the session file and in-memory session stay untouched.
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

export default function subagentReuse(pi: ExtensionAPI) {
	pi.on("context", (event, ctx) => {
		if (ctx.agent.kind !== "sub") return undefined;
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
}
