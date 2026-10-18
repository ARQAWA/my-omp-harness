import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { LOADABLE_TOOLS, loaded } from "../../shared/toolset.ts";
import description from "./description.md" with { type: "text" };

export default function loadTools(pi: ExtensionAPI) {
	const z = pi.zod;
	pi.registerTool({
		name: "load_tools",
		label: "load_tools",
		loadMode: "essential",
		concurrency: "shared",
		description: description.trim(),
		parameters: z.object({ names: z.array(z.enum(LOADABLE_TOOLS)) }),
		async execute(_toolCallId, params) {
			const all = ((await pi.getAllTools()) as (string | { name: string })[]).map(tool => (typeof tool === "string" ? tool : tool.name));
			const available = params.names.filter(name => all.includes(name));
			const missing = params.names.filter(name => !all.includes(name));
			for (const name of available) loaded.add(name);
			const active = await pi.getActiveTools();
			await pi.setActiveTools([...new Set([...active, ...available])]);
			const lines = [];
			if (available.length) lines.push(`Loaded: ${available.join(", ")}. Available from your next response.`);
			if (missing.length) lines.push(`Not available in this session: ${missing.join(", ")}.`);
			return { content: [{ type: "text" as const, text: lines.join("\n") }], isError: available.length === 0 };
		},
	});
}
