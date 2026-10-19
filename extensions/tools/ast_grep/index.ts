import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { dropEmpty, nativeRenderers, unavailable } from "../../shared/native.ts";
import description from "./description.md" with { type: "text" };
import { todoParameters, withoutTodo } from "../../shared/todo-ops.ts";

export default function astGrep(pi: ExtensionAPI) {
	const z = pi.zod;
	const parameters = todoParameters(pi, extra => z.object({
		pat: z.string().describe("ast pattern"),
		path: z.string().optional().describe('file, directory or glob; several as a semicolon-delimited list ("src; tests"); omitted searches the workspace root'),
		lang: z.string().optional().describe("language override, e.g. cpp for ambiguous .h files"),
		skip: z.number().optional().describe("matches to skip"),
		...extra,
	}));
	pi.registerTool({
		name: "ast_grep",
		label: "ast_grep",
		loadMode: "essential",
		concurrency: "shared",
		description: description.trim(),
		get parameters() {
			return parameters();
		},
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			if (!ctx.invokeTool) return unavailable("ast_grep");
			return ctx.invokeTool(dropEmpty(withoutTodo(params)), { signal, onUpdate });
		},
		...nativeRenderers("ast_grep"),
	});
}
