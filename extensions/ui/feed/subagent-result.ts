import type { Component, Theme } from "@oh-my-pi/pi-tui";
import { fitLine } from "./fit";
import { GLYPH } from "./glyphs";

/** The fields a subagent-result message carries in its details. */
interface ResultDetails {
	id?: string;
	model?: string;
	thinking?: string;
	seconds?: number;
	failed?: boolean;
}

const SHORT_THINKING: Record<string, string> = { minimal: "mn", low: "lo", medium: "md", high: "hi", xhigh: "xh", max: "mx", off: "no" };

/** The message text: a string as is, or the text parts of a content array joined by newlines. */
function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content.map((part: { text?: unknown }) => (typeof part?.text === "string" ? part.text : "")).join("\n");
}

/** A subagent final in the feed: a status circle, the id, the model and the seconds, then the text under it. */
export function renderSubagentResult(
	message: { content: unknown; details?: unknown },
	options: { expanded: boolean },
	theme: Theme,
	name: (ref: string) => string | undefined,
): Component {
	const details = (message.details ?? {}) as ResultDetails;
	const text = textOf(message.content).replace(/^\[[^\]\n]*\] ?/, "");
	const color = details.failed ? "error" : text.startsWith("status: DONE") || text.startsWith("CLEAN") ? "success" : "warning";
	let tail = "";
	if (details.model) {
		const label = name(details.model) ?? details.model.slice(details.model.lastIndexOf("/") + 1);
		const short = details.thinking ? (SHORT_THINKING[details.thinking] ?? details.thinking) : "";
		tail += ` · ${[label, short].filter(Boolean).join(" ")}`;
	}
	if (details.seconds !== undefined) tail += ` · ${details.seconds}s`;
	const lines = [`${theme.fg(color, GLYPH.circle)} ${theme.fg("text", details.id ?? "")}${theme.fg("dim", tail)}`];
	const rows = text.split("\n");
	const body = rows[0]?.startsWith("status:") ? rows.slice(1) : rows;
	for (const line of options.expanded ? body : body.slice(0, 1)) lines.push(theme.fg("muted", `  ${line}`));
	return {
		render(width: number) {
			return lines.map(line => fitLine(line, width));
		},
		invalidate() {},
	};
}
