import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { grep } from "@oh-my-pi/pi-natives";
import { statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const TYPE_EXTENSIONS: Record<string, string[]> = {
	js: [".js", ".mjs", ".cjs", ".jsx"],
	ts: [".ts", ".tsx", ".mts", ".cts"],
	py: [".py", ".pyi"],
	rust: [".rs"],
	go: [".go"],
	java: [".java"],
	c: [".c", ".h"],
	cpp: [".cpp", ".cc", ".cxx", ".hpp", ".hh", ".hxx", ".h"],
	md: [".md", ".markdown"],
	json: [".json", ".jsonc"],
	yaml: [".yml", ".yaml"],
	toml: [".toml"],
	sh: [".sh", ".bash", ".zsh"],
};

const TYPE_KEYS = Object.keys(TYPE_EXTENSIONS) as [string, ...string[]];

function pathMatchesType(filePath: string, type: string): boolean {
	const exts = TYPE_EXTENSIONS[type];
	if (!exts) return false;
	const lower = filePath.toLowerCase();
	return exts.some(ext => lower.endsWith(ext));
}

function displayPath(matchPath: string): string {
	return matchPath.split(/[/\\]/).join("/");
}

type GrepMatch = {
	path: string;
	lineNumber: number;
	line: string;
	matchCount?: number;
	contextBefore?: { lineNumber: number; line: string }[];
	contextAfter?: { lineNumber: number; line: string }[];
};

export default function rg(pi: ExtensionAPI) {
	const z = pi.zod;
	const outputMode = z.enum(["content", "files_with_matches", "count"]);

	pi.registerTool({
		name: "rg",
		label: "rg",
		loadMode: "essential",
		description:
			"Ripgrep-style search over file contents using the native engine with no per-call file cap. " +
			"Parameters: pattern (regex, required); path (file or directory, default working directory); glob (file glob filter); " +
			"type (js, ts, py, rust, go, java, c, cpp, md, json, yaml, toml, sh); output_mode (content | files_with_matches | count, default content); " +
			"-A, -B, -C (context lines; -C sets both when -A/-B omitted); -i (case insensitive); head_limit; offset; multiline. " +
			"For mapping a codebase, files_with_matches with one alternation of many terms is the fast path. " +
			"Content results are grouped by file, capped by head_limit and paged with offset. Respects .gitignore.",
		parameters: z.object({
			pattern: z.string(),
			path: z.string().optional(),
			glob: z.string().optional(),
			type: z.enum(TYPE_KEYS).optional(),
			output_mode: outputMode.optional(),
			"-A": z.number().optional(),
			"-B": z.number().optional(),
			"-C": z.number().optional(),
			"-i": z.boolean().optional(),
			head_limit: z.number().optional(),
			offset: z.number().optional(),
			multiline: z.boolean().optional(),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			if (params.type !== undefined && !(params.type in TYPE_EXTENSIONS)) {
				return { content: [{ type: "text", text: `Unknown type: ${params.type}` }] };
			}

			const searchPath = resolve(ctx.cwd, params.path ?? ctx.cwd);
			const isFile = (() => {
				try {
					return statSync(searchPath).isFile();
				} catch {
					return false;
				}
			})();
			const prefix = relative(ctx.cwd, searchPath);
			function shown(p: string): string {
				return displayPath(isFile ? prefix : prefix ? join(prefix, p) : p);
			}
			const outputModeVal = params.output_mode ?? "content";
			const offset = params.offset ?? 0;

			let contextBefore = params["-B"];
			let contextAfter = params["-A"];
			if (params["-C"] !== undefined) {
				if (contextBefore === undefined) contextBefore = params["-C"];
				if (contextAfter === undefined) contextAfter = params["-C"];
			}

			const mode =
				outputModeVal === "files_with_matches"
					? "filesWithMatches"
					: outputModeVal === "count"
						? "count"
						: "content";

			const defaultHead =
				outputModeVal === "content" ? 300 : 1000;
			const headLimit = params.head_limit ?? defaultHead;

			let result: {
				matches: GrepMatch[];
				totalMatches: number;
				filesWithMatches: number;
				filesSearched: number;
				limitReached?: boolean;
				skippedOversized?: boolean;
			};

			try {
				result = await grep({
					pattern: params.pattern,
					path: searchPath,
					glob: params.glob,
					ignoreCase: params["-i"],
					multiline: params.multiline,
					hidden: true,
					gitignore: true,
					...(outputModeVal === "content"
						? { contextBefore, contextAfter }
						: {}),
					maxColumns: 300,
					mode,
					maxCount: 100000,
					signal,
					timeoutMs: 30000,
				});
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				if (message.startsWith("regex parse error") || message.startsWith("regex error")) {
					return { content: [{ type: "text", text: `Invalid regex: ${message}` }] };
				}
				throw err;
			}

			let matches = result.matches;
			if (params.type !== undefined) {
				matches = matches.filter(m => pathMatchesType(m.path, params.type!));
			}

			if (matches.length === 0) {
				return { content: [{ type: "text", text: "No matches" }] };
			}

			let truncated = false;
			let shownCount = 0;

			if (outputModeVal === "content") {
				const matchingLines = matches.filter(m => m.lineNumber > 0);
				const slice = matchingLines.slice(offset, offset + headLimit);
				truncated = offset + slice.length < matchingLines.length;
				shownCount = slice.length;

				const fileOrder: string[] = [];
				const seenFiles = new Set<string>();
				for (const m of slice) {
					if (!seenFiles.has(m.path)) {
						seenFiles.add(m.path);
						fileOrder.push(m.path);
					}
				}

				const lines: string[] = [];
				for (const filePath of fileOrder) {
					lines.push(shown(filePath));
					const fileMatches = slice.filter(m => m.path === filePath);
					const printed = new Set<number>();
					const entries: { lineNumber: number; line: string; isMatch: boolean }[] = [];

					for (const m of fileMatches) {
						if (m.contextBefore) {
							for (const ctxLine of m.contextBefore) {
								if (!printed.has(ctxLine.lineNumber)) {
									printed.add(ctxLine.lineNumber);
									entries.push({ lineNumber: ctxLine.lineNumber, line: ctxLine.line, isMatch: false });
								}
							}
						}
						if (!printed.has(m.lineNumber)) {
							printed.add(m.lineNumber);
							entries.push({ lineNumber: m.lineNumber, line: m.line, isMatch: true });
						}
						if (m.contextAfter) {
							for (const ctxLine of m.contextAfter) {
								if (!printed.has(ctxLine.lineNumber)) {
									printed.add(ctxLine.lineNumber);
									entries.push({ lineNumber: ctxLine.lineNumber, line: ctxLine.line, isMatch: false });
								}
							}
						}
					}

					entries.sort((a, b) => a.lineNumber - b.lineNumber);
					for (const e of entries) {
						const sep = e.isMatch ? ":" : "-";
						lines.push(`${e.lineNumber}${sep}${e.line}`);
					}
					lines.push("");
				}

				if (truncated) {
					lines.push(`More results: use offset=${offset + shownCount}`);
				}
				const text = lines.join("\n").replace(/\n$/, "");
				return { content: [{ type: "text", text }] };
			}

			if (outputModeVal === "files_with_matches") {
				const files: string[] = [];
				const seen = new Set<string>();
				for (const m of matches) {
					if (!seen.has(m.path)) {
						seen.add(m.path);
						files.push(m.path);
					}
				}
				const slice = files.slice(offset, offset + headLimit);
				truncated = offset + slice.length < files.length;
				shownCount = slice.length;
				const lines = slice.map(f => shown(f));
				if (truncated) lines.push(`More results: use offset=${offset + shownCount}`);
				return { content: [{ type: "text", text: lines.join("\n") }] };
			}

			// count mode
			const files: { path: string; count: number }[] = [];
			const seen = new Set<string>();
			for (const m of matches) {
				if (!seen.has(m.path)) {
					seen.add(m.path);
					files.push({ path: m.path, count: m.matchCount ?? 0 });
				}
			}
			const slice = files.slice(offset, offset + headLimit);
			truncated = offset + slice.length < files.length;
			shownCount = slice.length;
			const lines = slice.map(f => `${shown(f.path)}:${f.count}`);
			if (truncated) lines.push(`More results: use offset=${offset + shownCount}`);
			return { content: [{ type: "text", text: lines.join("\n") }] };
		},
	});
}
