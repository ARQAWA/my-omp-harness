import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { lookup } from "@oh-my-pi/pi-coding-agent/config/registry";

const FOCUS_MAX_CHARS = 4_000;

export function triggerTokens(id: string): number | undefined {
	if (/composer/i.test(id)) return 170_000;
	if (/claude-fable/i.test(id)) return 272_000;
	const claude = /claude-(opus|sonnet)-(\d+)(?:[-.](\d{1,2})(?!\d))?/i.exec(id);
	if (claude) {
		const major = Number(claude[2]);
		const minor = Number(claude[3] ?? 0);
		return major > 5 || (major === 5 && minor >= 5) ? 272_000 : undefined;
	}
	const gpt = /(?:^|[/.])gpt-(\d+)/i.exec(id);
	return gpt !== null && Number(gpt[1]) >= 6 ? 244_800 : undefined;
}

function latestUserRequest(branch: readonly unknown[]): string | undefined {
	for (let i = branch.length - 1; i >= 0; i--) {
		const entry = branch[i] as
			| { type?: string; message?: { role?: string; attribution?: string; content?: unknown } }
			| undefined;
		if (entry?.type !== "message" || entry.message?.role !== "user") continue;
		if (entry.message.attribution === "agent") continue;
		const content = entry.message.content;
		const text = (
			typeof content === "string"
				? content
				: Array.isArray(content)
					? (content as { type?: string; text?: string }[])
							.filter(b => b?.type === "text")
							.map(b => b.text ?? "")
							.join("\n")
					: ""
		).trim();
		if (!text) continue;
		return text.length > FOCUS_MAX_CHARS ? `${text.slice(0, FOCUS_MAX_CHARS)}…` : text;
	}
	return undefined;
}

export default function compactAt231k(pi: ExtensionAPI) {
	const threshold = lookup("compaction.thresholdTokens")!;
	let applied: number | undefined;

	const sync = (ctx: ExtensionContext) => {
		if (ctx.agent.kind !== "main") return;
		const model = ctx.models.current();
		const window = ctx.getContextUsage()?.contextWindow ?? model?.contextWindow ?? 0;
		const trigger = model ? triggerTokens(model.id) : undefined;
		const want = trigger !== undefined && trigger < window ? trigger : undefined;
		if (want === applied) return;
		if (want !== undefined) threshold.override(pi.pi.settings, want);
		else threshold.clearOverride(pi.pi.settings);
		applied = want;
		if (ctx.hasUI) {
			ctx.ui.notify(
				want !== undefined
					? `Auto-compaction at ${want / 1000}k tokens (${model!.id})`
					: "Auto-compaction: default threshold",
				"info",
			);
		}
	};

	pi.on("session_start", (_event, ctx) => sync(ctx));
	pi.on("turn_start", (_event, ctx) => sync(ctx));
	pi.on("retry_fallback_applied", (_event, ctx) => sync(ctx));

	pi.on("session.compacting", (_event, ctx) => {
		const focus = latestUserRequest(ctx.sessionManager.getBranch());
		if (!focus) return;
		return {
			context: [
				"Current focus: keep the summary centered on what is needed to continue the task below — goal, decisions made, files and code touched, current state, and the immediate next step. Drop details unrelated to it.\n\n<latest-user-request>\n" +
					focus +
					"\n</latest-user-request>",
			],
		};
	});
}
