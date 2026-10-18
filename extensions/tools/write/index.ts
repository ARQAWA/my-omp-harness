import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { inFlight, lockKey } from "../../shared/locks.ts";
import { nativeRenderers, unavailable } from "../../shared/native.ts";
import description from "./description.md" with { type: "text" };

export default function (pi: ExtensionAPI) {
	const z = pi.zod;

	pi.registerTool({
		name: "write",
		label: "write",
		loadMode: "essential",
		concurrency: "shared",
		approval: "write",
		description: description.trim(),
		parameters: z.object({
			path: z.string().optional(),
			content: z.string().optional(),
			files: z.array(z.object({ path: z.string(), content: z.string() })).optional(),
		}),
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			if (!ctx.invokeTool) return unavailable("write");
			const filesGiven = params.files !== undefined && params.files.length > 0;
			const singleGiven = params.path !== undefined && params.path !== "" && params.content !== undefined;
			if (!filesGiven && !singleGiven && params.path !== undefined) {
				return ctx.invokeTool!({ path: params.path }, { signal, onUpdate });
			}
			if (filesGiven === singleGiven) {
				return { content: [{ type: "text" as const, text: "Give either path and content, or files." }], isError: true };
			}
			const items = singleGiven ? [{ path: params.path!, content: params.content! }] : params.files!;

			const runs = await Promise.all(
				items.map(async (item, index) => {
					const key = lockKey(item.path, ctx.cwd);
					if (inFlight.has(key)) {
						return { path: item.path, status: "busy" as const, message: undefined, text: "", raw: undefined };
					}
					inFlight.add(key);
					try {
						const result = await ctx.invokeTool!({ path: item.path, content: item.content }, { signal, onUpdate });
						const text = result.content.flatMap(part => (part.type === "text" && part.text ? [part.text] : [])).join("\n");
						if (result.isError) {
							return { path: item.path, status: "failed" as const, message: text || "failed", text: "", raw: undefined };
						}
						return { path: item.path, status: "written" as const, message: undefined, text, raw: result };
					} catch (error) {
						const message = error instanceof Error ? error.message : String(error);
						return { path: item.path, status: "failed" as const, message, text: "", raw: undefined };
					} finally {
						inFlight.delete(key);
					}
				}),
			);

			const [only] = runs;
			if (singleGiven && only!.status === "written" && only!.raw) return only!.raw;

			const files = runs.map(({ path, status, message }) =>
				message === undefined ? { path, status } : { path, status, message },
			);
			const lines: string[] = [];
			for (const run of runs) {
				if (run.status !== "written") continue;
				lines.push(`Written: ${run.path}`);
				if (run.text) lines.push(run.text.split("\n").map(line => `  ${line}`).join("\n"));
			}
			for (const run of runs) {
				if (run.status === "busy") {
					lines.push(`Busy, not written (another write or edit of this file is in progress): ${run.path}`);
				}
			}
			for (const run of runs) {
				if (run.status === "failed") lines.push(`Failed: ${run.path}: ${run.message}`);
			}
			const isError = runs.some(run => run.status !== "written");
			return { content: [{ type: "text" as const, text: lines.join("\n") }], details: { files }, isError };
		},
		...nativeRenderers("write"),
	});
}
