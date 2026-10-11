import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { type Component, Text } from "@oh-my-pi/pi-tui";
import { type ToolRenderer, toolRenderers } from "@oh-my-pi/pi-tui/tools";

const ASK_DESCRIPTION =
	"Ask only for materially different tradeoffs the user must decide. Default: act using code/config/docs/history and conventions. Several viable choices: pick conservative/standard, proceed, state choice.\n\n" +
	"- Batch related questions; 2–5 distinct options each; short labels, tradeoffs in `description`.\n" +
	"- `recommended` (0-based index) auto-adds \" (Recommended)\"; `multi: true` permits multiple selections.\n" +
	"- NEVER supply \"Other\": UI adds \"Other (type your own)\". Clarifying custom input? Answer first; re-ask unresolved questions.\n" +
	"- Optional `title` names the whole form: it becomes the first question's header chip, or prefixes the first question's text when that question already has a header.\n" +
	"- Optional option `id`: the result adds a line `Selected option ids:` with `<question id>=<option id>` for each chosen option that has an id.";

type NativeResult = { content: { type: string; text?: string }[]; details?: unknown; isError?: boolean };
type Option = { label: string; description?: string; preview?: string; id?: string };
type Question = { id: string; question: string; header?: string; multi?: boolean; recommended?: number; options: Option[] };
type AskParams = { title?: string; questions: Question[] };

const RECOMMENDED_SUFFIX = " (Recommended)";

/** The first line of the first text block of a tool result. */
function firstTextLine(result: unknown): string {
	const content =
		typeof result === "object" && result !== null && "content" in result && Array.isArray(result.content)
			? result.content
			: [];
	for (const block of content) {
		if (typeof block === "object" && block !== null && "text" in block && typeof block.text === "string") {
			return block.text.split("\n")[0] ?? "";
		}
	}
	return "";
}

export default function (pi: ExtensionAPI) {
	const z = pi.zod;

	const optionSchema = z.object({
		label: z.string(),
		description: z.string().optional(),
		preview: z.string().optional(),
		id: z.string().optional(),
	});

	pi.registerTool({
		name: "ask",
		label: "ask",
		loadMode: "essential",
		approval: "read",
		concurrency: "exclusive",
		description: ASK_DESCRIPTION,
		parameters: z.object({
			title: z.string().optional(),
			questions: z
				.array(
					z.object({
						id: z.string(),
						question: z.string(),
						header: z.string().optional(),
						multi: z.boolean().optional(),
						recommended: z.number().optional(),
						options: z.array(optionSchema).min(2),
					}),
				)
				.min(1),
		}),
		async execute(_toolCallId, rawParams, signal, onUpdate, ctx) {
			if (!ctx.invokeTool) {
				return {
					content: [{ type: "text" as const, text: "ask needs an interactive session; it is not available here." }],
					isError: true,
				};
			}
			const params = rawParams as AskParams;

			const questions: Question[] = params.questions.map(question => ({
				...question,
				options: question.options.map(({ id: _optionId, ...option }) => option),
			}));
			if (params.title !== undefined && questions.length > 0) {
				const first = questions[0]!;
				questions[0] = !first.header
					? { ...first, header: params.title }
					: { ...first, question: `${params.title}. ${first.question}` };
			}

			const result = (await ctx.invokeTool({ questions }, { signal, onUpdate })) as NativeResult;
			if (result.isError) return result;

			const baseDetails = (result.details ?? {}) as Record<string, unknown>;
			const details = baseDetails as {
				selectedOptions?: string[];
				results?: { id: string; selectedOptions?: string[] }[];
			};
			const answers: { id: string; selectedOptions?: string[] }[] =
				details.results ??
				(details.selectedOptions !== undefined
					? [{ id: questions[0]!.id, selectedOptions: details.selectedOptions }]
					: []);

			const pairs: string[] = [];
			const selectedOptionIds: Record<string, string[]> = {};
			for (const question of params.questions) {
				const answer = answers.find(item => item.id === question.id);
				if (!answer) continue;
				for (const selected of answer.selectedOptions ?? []) {
					const label = selected.endsWith(RECOMMENDED_SUFFIX)
						? selected.slice(0, -RECOMMENDED_SUFFIX.length)
						: selected;
					const option = question.options.find(item => item.label === label);
					if (option?.id === undefined) continue;
					pairs.push(`${question.id}=${option.id}`);
					const ids = selectedOptionIds[question.id] ?? [];
					ids.push(option.id);
					selectedOptionIds[question.id] = ids;
				}
			}
			if (pairs.length === 0) return result;

			return {
				...result,
				content: [...result.content, { type: "text", text: `Selected option ids: ${pairs.join(", ")}` }],
				details: { ...baseDetails, selectedOptionIds },
			};
		},
		renderCall: (...args: Parameters<ToolRenderer["renderCall"]>): Component => {
			const host = toolRenderers["ask"];
			return host ? (host.renderCall(...args) as Component) : new Text("ask", 0, 0);
		},
		renderResult: (...args: Parameters<ToolRenderer["renderResult"]>): Component => {
			const host = toolRenderers["ask"];
			return host ? (host.renderResult(...args) as Component) : new Text(firstTextLine(args[0]), 0, 0);
		},
	});
}
