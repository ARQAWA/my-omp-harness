import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { dropEmpty, nativeRenderers, unavailable } from "../../shared/native.ts";
import description from "./description.md" with { type: "text" };
import { todoParameters, withoutTodo } from "../../shared/todo-ops.ts";

const ACTIONS = ["diagnostics", "definition", "references", "hover", "symbols", "rename", "rename_file", "code_actions", "type_definition", "implementation", "status", "reload", "capabilities", "request"] as const;

export default function lsp(pi: ExtensionAPI) {
	const z = pi.zod;
	const parameters = todoParameters(pi, extra => z.object({
		action: z.enum(ACTIONS),
		file: z.string().optional(),
		line: z.number().optional(),
		symbol: z.string().optional(),
		query: z.string().optional(),
		new_name: z.string().optional(),
		apply: z.boolean().optional(),
		timeout: z.number().optional().describe("Timeout in seconds (default 20; range 5-300)."),
		payload: z.string().optional(),
		...extra,
	}));
	pi.registerTool({
		name: "lsp",
		label: "lsp",
		loadMode: "essential",
		concurrency: "shared",
		description: description.trim(),
		get parameters() {
			return parameters();
		},
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			if (!ctx.invokeTool) return unavailable("lsp");
			return ctx.invokeTool(dropEmpty(withoutTodo(params)), { signal, onUpdate });
		},
		...nativeRenderers("lsp"),
	});
}
