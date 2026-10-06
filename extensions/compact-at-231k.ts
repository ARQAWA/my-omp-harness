import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { lookup } from "@oh-my-pi/pi-coding-agent/config/registry";

const TRIGGER_TOKENS = 231_200;
const DEFAULT_RESERVE_TOKENS = 16_384;
const FOCUS_MAX_CHARS = 4_000;

export function isTargetModel(id: string): boolean {
	const claude = /claude-(opus|sonnet)-(\d+)(?:[-.](\d{1,2})(?!\d))?/i.exec(id);
	if (claude) {
		const major = Number(claude[2]);
		const minor = Number(claude[3] ?? 0);
		return major > 5 || (major === 5 && minor >= 5);
	}
	const gpt = /(?:^|[/.])gpt-(\d+)/i.exec(id);
	return gpt !== null && Number(gpt[1]) >= 6;
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
	const reserveSetting = lookup("compaction.reserveTokens")!;
	let applied = false;

	const sync = (ctx: ExtensionContext) => {
		if (ctx.agent.kind !== "main") return;
		const model = ctx.models.current();
		const window = ctx.getContextUsage()?.contextWindow ?? model?.contextWindow ?? 0;
		const configuredReserve = reserveSetting.get(pi.pi.settings) as number | undefined;
		const reserve = Math.max(Math.floor(window * 0.15), configuredReserve ?? DEFAULT_RESERVE_TOKENS);
		const want = !!model && isTargetModel(model.id) && TRIGGER_TOKENS < window - reserve;
		if (want === applied) return;
		if (want) threshold.override(pi.pi.settings, TRIGGER_TOKENS);
		else threshold.clearOverride(pi.pi.settings);
		applied = want;
		if (ctx.hasUI) {
			ctx.ui.notify(
				want ? `Auto-compaction at 231.2k tokens (${model.id})` : "Auto-compaction: default threshold",
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
