import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { lookup } from "@oh-my-pi/pi-coding-agent/config/registry";

export function triggerTokens(id: string): number | undefined {
	if (/claude-/i.test(id)) return 270_000;
	if (/(?:^|[/.])gpt-\d/i.test(id)) return 231_200;
	return undefined;
}

export default function autocompaction(pi: ExtensionAPI) {
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
	};

	pi.on("session_start", (_event, ctx) => sync(ctx));
	pi.on("turn_start", (_event, ctx) => sync(ctx));
	pi.on("retry_fallback_applied", (_event, ctx) => sync(ctx));
}
