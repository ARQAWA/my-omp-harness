import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { lookup } from "@oh-my-pi/pi-coding-agent/config/registry";

const ROUTES = {
	subagent_simple: {
		gpt: "openai-codex/gpt-6-luna:low",
		claude: "anthropic/claude-sonnet-5-5:off",
	},
	subagent_routine: {
		gpt: "openai-codex/gpt-6-luna:medium",
		claude: "anthropic/claude-sonnet-5-5:medium",
	},
	subagent_medium: {
		gpt: "openai-codex/gpt-6-luna:xhigh",
		claude: "anthropic/claude-sonnet-5-5:high",
	},
	subagent_complex: {
		gpt: "openai-codex/gpt-6.1-sol:low",
		claude: "anthropic/claude-opus-5-5:low",
	},
} as const;

const NAMED: Record<string, { gpt: string | string[]; claude: string | string[] }> = {
	spotty: { gpt: "openai-codex/gpt-6-sol:medium", claude: "anthropic/claude-sonnet-5-5:medium" },
	smarty: { gpt: "openai-codex/gpt-6.1-sol:low", claude: "anthropic/claude-opus-5-5:low" },
	bossy: { gpt: "openai-codex/gpt-6.1-sol:medium", claude: "anthropic/claude-opus-5-5:low" },
	enot: { gpt: ["cursor/composer-2.5", "openai-codex/gpt-6-luna:low"], claude: "anthropic/claude-sonnet-5-5:off" },
	lunatik: { gpt: ["cursor/composer-2.5:medium", "openai-codex/gpt-6-luna:medium"], claude: ["cursor/composer-2.5:medium", "anthropic/claude-sonnet-5-5:low"] },
	lunatik_high: { gpt: ["cursor/composer-2.5:medium", "openai-codex/gpt-6-luna:medium"], claude: ["cursor/composer-2.5:medium", "anthropic/claude-sonnet-5-5:low"] },
	lunatron_low: { gpt: "openai-codex/gpt-6.1-sol:low", claude: "anthropic/claude-sonnet-5-5:high" },
	lunatron_medium: { gpt: "openai-codex/gpt-6.1-sol:medium", claude: "anthropic/claude-opus-5-5:low" },
	lunatron_high: { gpt: "openai-codex/gpt-6.1-sol:high", claude: "anthropic/claude-opus-5-5:low" },
	code_writer: { gpt: ["cursor/composer-2.5:medium", "openai-codex/gpt-6-luna:low"], claude: "anthropic/claude-sonnet-5-5:off" },
};

export default function subagentModelPolicy(pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		if (ctx.agent.kind === "sub") lookup("retry.modelFallback")!.override(pi.pi.settings, false);
	});
	pi.on("before_subagent_spawn", (event, ctx) => {
		const named = Object.hasOwn(NAMED, event.agent) ? NAMED[event.agent] : undefined;
		const tier = event.modelRole?.replace(/^@/, "");
		if (!named && (!tier || !Object.hasOwn(ROUTES, tier))) {
			return {
				block: true,
				reason: "Select task complexity using model: @subagent_simple, @subagent_routine, @subagent_medium, or @subagent_complex.",
			};
		}
		const route = named ?? ROUTES[tier as keyof typeof ROUTES];
		const label = named ? event.agent : tier;
		const parent = ctx.models.current();
		if (parent && /^gpt[-.]/i.test(parent.id)) {
			return { model: route.gpt, note: `GPT parent: ${label}` };
		}
		return { model: route.claude, note: `Claude route: ${label}` };
	});
}
