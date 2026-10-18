import { type Component, Text } from "@oh-my-pi/pi-tui";
import { type ToolRenderer, toolRenderers } from "@oh-my-pi/pi-tui/tools";

/** Result of a tool that has no native counterpart to delegate to in this agent. */
export function unavailable(name: string) {
	return { content: [{ type: "text" as const, text: `${name} is not available to this agent.` }], isError: true as const };
}

/** Arguments without the null and empty-string values GPT sends for omitted optional fields. */
export function dropEmpty(params: object): Record<string, unknown> {
	return Object.fromEntries(Object.entries(params).filter(([, value]) => value !== null && value !== undefined && value !== ""));
}

/** The first line of the first text block of a tool result. */
function firstTextLine(result: unknown): string {
	const content =
		typeof result === "object" && result !== null && "content" in result && Array.isArray(result.content) ? result.content : [];
	for (const block of content) {
		if (typeof block === "object" && block !== null && "text" in block && typeof block.text === "string") {
			return block.text.split("\n")[0] ?? "";
		}
	}
	return "";
}

/** omp's own renderers for a wrapper that keeps a native tool's name, with plain-text fallbacks. */
export function nativeRenderers(name: string) {
	return {
		renderCall: (...args: Parameters<ToolRenderer["renderCall"]>): Component => {
			const host = toolRenderers[name];
			return host ? (host.renderCall(...args) as Component) : new Text(name, 0, 0);
		},
		renderResult: (...args: Parameters<ToolRenderer["renderResult"]>): Component => {
			const host = toolRenderers[name];
			return host ? (host.renderResult(...args) as Component) : new Text(firstTextLine(args[0]), 0, 0);
		},
	};
}
