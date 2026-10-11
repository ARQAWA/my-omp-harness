import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { type Component, Text } from "@oh-my-pi/pi-tui";
import { type ToolRenderer, toolRenderers } from "@oh-my-pi/pi-tui/tools";
import { lookup } from "@oh-my-pi/pi-coding-agent/config/registry";
import { editDescription, editGrammar } from "@oh-my-pi/pi-natives";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const CLAUDE_DESCRIPTION =
	"Replace exact text in files. Give path, old_string and new_string for one replacement, or edits: [{path, old_string, new_string, replace_all?}, …] for several replacements in one call, in one or many files. " +
	"Edits of different files run in parallel; edits of one file apply in the given order, and after a failed edit the rest of that file's edits are skipped. " +
	"A file that another edit or write is still changing is refused as busy, and the other files are still edited. " +
	"old_string must identify one place in the file: add context, or set replace_all: true to replace every occurrence. Read a file before editing it. " +
	"The result lists edited, busy, failed and skipped files; a failed edit shows the nearest matching lines with line numbers.";

type EditItem = { path: string; old_string: string; new_string: string; replace_all?: boolean };
type Params = Partial<EditItem> & { input?: string; edits?: EditItem[] };
type NativeResult = { content: { type: string; text?: string }[]; details?: unknown; isError?: boolean };
type FileRun = {
	path: string;
	status: "edited" | "busy" | "failed";
	applied: number;
	total: number;
	results: NativeResult[];
	failure?: string;
	failedEdit?: number;
	nearest?: string;
};

const fileLocks = Symbol.for("my-omp-harness.fileLocks");
const lockStore = globalThis as unknown as Record<symbol, Set<string> | undefined>;
const inFlight = (lockStore[fileLocks] ??= new Set<string>());

function lockKey(path: string, cwd: string): string {
	if (path.includes("://")) return path;
	const absolute = resolve(cwd, path);
	return process.platform === "win32" ? absolute.toLowerCase() : absolute;
}

function splitFileLines(text: string): string[] {
	let body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
	if (body === "") return [];
	const lines = body.split("\n").map(l => (l.endsWith("\r") ? l.slice(0, -1) : l));
	if (lines[lines.length - 1] === "") lines.pop();
	return lines;
}

function lineSimilarity(a: string, b: string): number {
	const max = Math.max(a.length, b.length);
	if (max === 0) return 1;
	let same = 0;
	for (let i = 0; i < Math.min(a.length, b.length); i++) {
		if (a[i] === b[i]) same++;
	}
	return same / max;
}

function nearestMatchText(relPath: string, oldString: string, cwd: string): string | undefined {
	let lines: string[];
	try {
		lines = splitFileLines(readFileSync(resolve(cwd, relPath), "utf8"));
	} catch {
		return undefined;
	}
	const want = splitFileLines(oldString).map(l => l.replace(/\s+/g, " ").trim());
	const n = want.length;
	if (n === 0 || lines.length < n) return undefined;
	const norm = lines.map(l => l.replace(/\s+/g, " ").trim());
	let bestStart = 0;
	let bestScore = -1;
	for (let s = 0; s + n <= lines.length; s++) {
		let score = 0;
		for (let k = 0; k < n; k++) score += lineSimilarity(norm[s + k]!, want[k]!);
		if (score > bestScore) {
			bestScore = score;
			bestStart = s;
		}
	}
	const out = [`Nearest match in ${relPath} (lines ${bestStart + 1}-${bestStart + n}):`];
	for (let i = bestStart; i < bestStart + n; i++) out.push(`${i + 1}|${lines[i]!}`);
	return out.join("\n");
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

function cleanParams(raw: unknown): Params {
	const params = { ...(raw as Params) };
	if (params.path === "") delete params.path;
	if (params.old_string === "") delete params.old_string;
	if (params.edits?.length === 0) delete params.edits;
	return params;
}

type PatchSection = {
	path: string;
	kind: "add" | "delete" | "update";
	lines: string[];
	move: boolean;
	hunks: string[][];
};
type Rejection = { index: number; total: number; text: string; lines: string[] };
type PatchRun = {
	path: string;
	status: "edited" | "partial" | "failed" | "busy";
	applied: number;
	total: number;
	results: NativeResult[];
	appliedHunks: number[];
	rejections: Rejection[];
	failure?: string;
};

/** Splits a `*** Begin Patch` envelope into file sections; undefined when the input cannot be split. */
function parsePatch(input: string): PatchSection[] | undefined {
	const lines = input.split("\n");
	if (lines.at(-1) === "") lines.pop();
	if (lines.length < 2 || lines[0] !== "*** Begin Patch" || lines.at(-1) !== "*** End Patch") return undefined;
	const sections: PatchSection[] = [];
	let current: PatchSection | undefined;
	let hunkStarted = false;
	for (const line of lines.slice(1, -1)) {
		const header = /^\*\*\* (Add|Delete|Update) File: (.*)$/.exec(line);
		if (header) {
			current = {
				path: header[2]!,
				kind: header[1] === "Add" ? "add" : header[1] === "Delete" ? "delete" : "update",
				lines: [line],
				move: false,
				hunks: [],
			};
			sections.push(current);
			hunkStarted = false;
			continue;
		}
		if (!current) return undefined;
		if (line.startsWith("*** Move to: ")) {
			if (current.kind !== "update" || current.lines.length !== 1) return undefined;
			current.move = true;
			current.lines.push(line);
			continue;
		}
		if (line.startsWith("*** ") && line !== "*** End of File") return undefined;
		current.lines.push(line);
		if (current.hunks.length === 0) current.hunks.push([]);
		if (line.startsWith("@@")) {
			if (hunkStarted) current.hunks.push([]);
			hunkStarted = true;
		}
		current.hunks.at(-1)!.push(line);
	}
	return sections.length > 0 ? sections : undefined;
}

/** Number of hunks a section counts for: 1 for Add, Delete and Update with Move. */
function hunkCount(section: PatchSection): number {
	return section.kind === "update" && !section.move ? Math.max(1, section.hunks.length) : 1;
}

function textOf(result: NativeResult): string {
	return result.content.flatMap(part => (part.type === "text" && part.text ? [part.text] : [])).join("\n");
}

function diffOf(result: NativeResult): string {
	const details = result.details;
	return typeof details === "object" && details !== null && "diff" in details && typeof details.diff === "string" ? details.diff : "";
}

export default function (pi: ExtensionAPI) {
	const z = pi.zod;
	let gpt = false;
	function syncModel(ctx: { models?: { current?: () => { id?: string } | undefined }; model?: { id?: string } }): void {
		const model = ctx.models?.current?.() ?? ctx.model;
		gpt = /gpt/i.test(model?.id ?? "");
	}

	const claudeParameters = z.object({
		path: z.string().optional(),
		old_string: z.string().optional(),
		new_string: z.string().optional(),
		replace_all: z.boolean().optional(),
		edits: z
			.array(z.object({ path: z.string(), old_string: z.string(), new_string: z.string(), replace_all: z.boolean().optional() }))
			.optional(),
	});
	const gptParameters = z.object({ input: z.string() });

	pi.on("session_start", async (_event, ctx) => {
		syncModel(ctx);
		try {
			lookup("edit.mode")?.override(pi.pi.settings, "replace");
			lookup("edit.modelVariants")?.override(pi.pi.settings, { gpt: "apply_patch" });
		} catch {}
	});
	pi.on("before_agent_start", async (_event, ctx) => {
		syncModel(ctx);
	});
	pi.on("turn_start", async (_event, ctx) => {
		syncModel(ctx);
	});

	pi.registerTool({
		name: "edit",
		label: "edit",
		loadMode: "essential",
		approval: "write",
		get description() {
			return gpt ? editDescription("apply_patch") : CLAUDE_DESCRIPTION;
		},
		get parameters() {
			return gpt ? gptParameters : claudeParameters;
		},
		get customFormat() {
			return gpt ? { syntax: "lark", definition: editGrammar("apply_patch") } : undefined;
		},
		get customWireName() {
			return gpt ? "apply_patch" : undefined;
		},
		concurrency: (args: { input?: unknown } | undefined) => (typeof args?.input === "string" ? "exclusive" : "shared"),
		async execute(_toolCallId, rawParams, signal, onUpdate, ctx) {
			const params = cleanParams(rawParams);
			if (!ctx.invokeTool) {
				return {
					content: [{ type: "text" as const, text: "edit is not available to this agent." }],
					isError: true,
				};
			}
			if (typeof params.input === "string") {
				const sections = parsePatch(params.input);
				if (!sections) return ctx.invokeTool!({ input: params.input }, { signal, onUpdate });

				const callNative = async (input: string): Promise<{ result?: NativeResult; error?: string }> => {
					try {
						const result = (await ctx.invokeTool!({ input }, { signal, onUpdate })) as NativeResult;
						return result.isError ? { result, error: textOf(result) } : { result };
					} catch (error) {
						return { error: error instanceof Error ? error.message : String(error) };
					}
				};

				const applyGroup = async (key: string, group: PatchSection[]): Promise<PatchRun> => {
					const path = group[0]!.path;
					const total = group.reduce((sum, section) => sum + hunkCount(section), 0);
					if (inFlight.has(key)) return { path, status: "busy", applied: 0, total, results: [], appliedHunks: [], rejections: [] };
					inFlight.add(key);
					try {
						const whole = await callNative(`*** Begin Patch\n${group.flatMap(section => section.lines).join("\n")}\n*** End Patch`);
						if (whole.result && whole.error === undefined) {
							return { path, status: "edited", applied: total, total, results: [whole.result], appliedHunks: [], rejections: [] };
						}
						const hunks = group.every(section => section.kind === "update" && !section.move)
							? group.flatMap(section => section.hunks.map(lines => ({ path: section.path, lines })))
							: [];
						if (hunks.length < 2 || hunks.length !== total) {
							return { path, status: "failed", applied: 0, total, results: [], appliedHunks: [], rejections: [], failure: whole.error ?? "" };
						}
						const results: NativeResult[] = [];
						const appliedHunks: number[] = [];
						const rejections: Rejection[] = [];
						for (const [index, hunk] of hunks.entries()) {
							const outcome = await callNative(`*** Begin Patch\n*** Update File: ${hunk.path}\n${hunk.lines.join("\n")}\n*** End Patch`);
							if (outcome.result && outcome.error === undefined) {
								results.push(outcome.result);
								appliedHunks.push(index + 1);
							} else {
								rejections.push({ index: index + 1, total, text: outcome.error ?? "", lines: hunk.lines });
							}
						}
						const status = rejections.length === 0 ? "edited" : appliedHunks.length > 0 ? "partial" : "failed";
						return { path, status, applied: appliedHunks.length, total, results, appliedHunks, rejections };
					} finally {
						inFlight.delete(key);
					}
				};

				const patchGroups = new Map<string, PatchSection[]>();
				for (const section of sections) {
					const key = lockKey(section.path, ctx.cwd);
					patchGroups.set(key, [...(patchGroups.get(key) ?? []), section]);
				}
				const patchRuns = await Promise.all([...patchGroups].map(([key, group]) => applyGroup(key, group)));

				const out: string[] = [];
				for (const run of patchRuns) {
					if (run.status === "busy") {
						out.push(`Busy, not edited (another write or edit of this file is in progress): ${run.path}`);
						continue;
					}
					if (run.status === "edited") out.push(`Applied: ${run.path} (${run.total} hunk(s))`);
					if (run.status === "partial") out.push(`Applied: ${run.path} (hunks ${run.appliedHunks.join(", ")} of ${run.total})`);
					for (const result of run.results) {
						const text = textOf(result);
						if (text) out.push(text.split("\n").map(line => `  ${line}`).join("\n"));
					}
					for (const rejection of run.rejections) {
						out.push(`Rejected: ${run.path}, hunk ${rejection.index} of ${rejection.total}:`, rejection.text);
					}
					if (run.status === "failed" && run.rejections.length === 0) out.push(`Rejected: ${run.path}: ${run.failure || "failed"}`);
				}
				const applied = patchRuns.reduce((sum, run) => sum + run.applied, 0);
				const total = patchRuns.reduce((sum, run) => sum + run.total, 0);
				if (total > applied) out.push(`Applied ${applied} of ${total} hunks; rejected ${total - applied}.`);

				return {
					content: [{ type: "text" as const, text: out.join("\n") }],
					details: {
						diff: patchRuns.flatMap(run => run.results.map(result => diffOf(result))).filter(Boolean).join("\n"),
						perFileResults: patchRuns.map(run => ({
							path: run.path,
							diff: run.results.map(result => diffOf(result)).filter(Boolean).join("\n"),
							isError: run.status !== "edited",
						})),
						files: patchRuns.map(run => ({
							path: run.path,
							status: run.status,
							applied: run.applied,
							total: run.total,
							...(run.status === "partial" || run.status === "failed"
								? { message: (run.rejections[0]?.text ?? run.failure ?? "").split("\n")[0] || "failed" }
								: {}),
						})),
					},
					isError: patchRuns.some(run => run.status !== "edited"),
				};
			}
			const singleGiven = params.path !== undefined && params.old_string !== undefined && params.new_string !== undefined;
			const multiGiven = params.edits !== undefined && params.edits.length > 0;
			if (singleGiven === multiGiven) {
				return {
					content: [{ type: "text" as const, text: "Give either path, old_string and new_string, or edits." }],
					isError: true,
				};
			}
			const items: EditItem[] = singleGiven
				? [{ path: params.path!, old_string: params.old_string!, new_string: params.new_string!, replace_all: params.replace_all }]
				: params.edits!;

			const groups = new Map<string, EditItem[]>();
			for (const item of items) {
				const key = lockKey(item.path, ctx.cwd);
				groups.set(key, [...(groups.get(key) ?? []), item]);
			}

			const runFile = async (key: string, edits: EditItem[]): Promise<FileRun> => {
				const path = edits[0]!.path;
				const total = edits.length;
				if (inFlight.has(key)) return { path, status: "busy", applied: 0, total, results: [] };
				inFlight.add(key);
				const results: NativeResult[] = [];
				try {
					for (const [index, item] of edits.entries()) {
						let failure: string | undefined;
						try {
							const args =
								item.replace_all === undefined
									? { path: item.path, old_string: item.old_string, new_string: item.new_string }
									: { path: item.path, old_string: item.old_string, new_string: item.new_string, replace_all: item.replace_all };
							const result = (await ctx.invokeTool!(args, { signal, onUpdate })) as NativeResult;
							results.push(result);
							if (result.isError) {
								failure = result.content
									.flatMap(part => (part.type === "text" && part.text ? [part.text] : []))
									.join("\n");
							}
						} catch (error) {
							failure = error instanceof Error ? error.message : String(error);
						}
						if (failure !== undefined) {
							return {
								path,
								status: "failed",
								applied: index,
								total,
								results,
								failure,
								failedEdit: index + 1,
								nearest: nearestMatchText(item.path, item.old_string, ctx.cwd),
							};
						}
					}
					return { path, status: "edited", applied: total, total, results };
				} finally {
					inFlight.delete(key);
				}
			};

			const runs = await Promise.all([...groups].map(([key, edits]) => runFile(key, edits)));

			if (singleGiven) {
				const run = runs[0]!;
				if (run.status === "edited") return run.results[0]!;
				if (run.status === "busy") {
					return {
						content: [
							{
								type: "text" as const,
								text: `Busy, not edited (another write or edit of this file is in progress): ${run.path}`,
							},
						],
						isError: true,
					};
				}
				const text = [run.failure ?? "", run.nearest ?? ""].filter(part => part !== "").join("\n");
				return { content: [{ type: "text" as const, text }], details: run.results.at(-1)?.details, isError: true };
			}

			const lines: string[] = [];
			for (const run of runs) {
				if (run.status !== "edited") continue;
				lines.push(`Edited: ${run.path} (${run.total} replacement(s))`);
				for (const result of run.results) {
					const text = result.content
						.flatMap(part => (part.type === "text" && part.text ? [part.text] : []))
						.join("\n");
					if (text) lines.push(text.split("\n").map(line => `  ${line}`).join("\n"));
				}
			}
			for (const run of runs) {
				if (run.status === "busy") {
					lines.push(`Busy, not edited (another write or edit of this file is in progress): ${run.path}`);
				}
			}
			for (const run of runs) {
				if (run.status !== "failed") continue;
				lines.push(`Failed: ${run.path}, edit ${run.failedEdit} of ${run.total}: ${run.failure || "failed"}`);
				if (run.nearest) lines.push(run.nearest);
				if (run.applied > 0) lines.push(`  Applied before the failure: ${run.applied} of ${run.total}`);
			}
			for (const run of runs) {
				if (run.status === "failed" && run.failedEdit! < run.total) {
					lines.push(`Skipped after the failure above: ${run.path}, edits ${run.failedEdit! + 1}-${run.total}`);
				}
			}
			const files = runs.map(run => ({
				path: run.path,
				status: run.status,
				applied: run.applied,
				total: run.total,
				...(run.status === "failed" ? { message: run.failure || "failed" } : {}),
			}));
			return {
				content: [{ type: "text" as const, text: lines.join("\n") }],
				details: {
					files,
					diff: runs.flatMap(run => run.results.map(result => diffOf(result))).filter(Boolean).join("\n"),
					perFileResults: runs.map(run => ({
						path: run.path,
						diff: run.results.map(result => diffOf(result)).filter(Boolean).join("\n"),
						isError: run.status !== "edited",
					})),
				},
				isError: runs.some(run => run.status !== "edited"),
			};
		},
		renderCall: (...args: Parameters<ToolRenderer["renderCall"]>): Component => {
			const host = toolRenderers["edit"];
			return host ? (host.renderCall(...args) as Component) : new Text("edit", 0, 0);
		},
		renderResult: (...args: Parameters<ToolRenderer["renderResult"]>): Component => {
			const host = toolRenderers["edit"];
			return host ? (host.renderResult(...args) as Component) : new Text(firstTextLine(args[0]), 0, 0);
		},
	});
}
