import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { type Component, Text } from "@oh-my-pi/pi-tui";
import { type ToolRenderer, toolRenderers } from "@oh-my-pi/pi-tui/tools";
import { resolve } from "node:path";

const DESCRIPTION =
	"Create or overwrite files. Give path and content for one file, or files: [{path, content}, …] to write several files at once; " +
	"they are written in parallel. A file that another write is still writing is refused as busy and the other files are still written; " +
	"the result lists written, busy and failed files. Internal URLs work as in the built-in write: agent:// sends a message, " +
	"local:// writes a session file, xd:// calls a tool device, and archive and SQLite paths write entries.";

const fileLocks = Symbol.for("my-omp-harness.fileLocks");
const lockStore = globalThis as unknown as Record<symbol, Set<string> | undefined>;
const inFlight = (lockStore[fileLocks] ??= new Set<string>());

function lockKey(path: string, cwd: string): string {
	if (path.includes("://")) return path;
	const absolute = resolve(cwd, path);
	return process.platform === "win32" ? absolute.toLowerCase() : absolute;
}

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

	pi.registerTool({
		name: "write",
		label: "write",
		loadMode: "essential",
		concurrency: "shared",
		approval: "write",
		description: DESCRIPTION,
		parameters: z.object({
			path: z.string().optional(),
			content: z.string().optional(),
			files: z.array(z.object({ path: z.string(), content: z.string() })).optional(),
		}),
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			if (!ctx.invokeTool) {
				return {
					content: [{ type: "text" as const, text: "write is not available to this agent." }],
					isError: true,
				};
			}
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
		renderCall: (...args: Parameters<ToolRenderer["renderCall"]>): Component => {
			const host = toolRenderers["write"];
			return host ? (host.renderCall(...args) as Component) : new Text("write", 0, 0);
		},
		renderResult: (...args: Parameters<ToolRenderer["renderResult"]>): Component => {
			const host = toolRenderers["write"];
			return host ? (host.renderResult(...args) as Component) : new Text(firstTextLine(args[0]), 0, 0);
		},
	});
}
