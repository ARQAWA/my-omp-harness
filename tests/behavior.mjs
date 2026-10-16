// Behavior regressions for the harness extensions. Each case runs the actual worktree .ts source, loaded
// through Node's module hooks. @oh-my-pi packages are small stubs; nothing is installed or spawned.
// Direct run: node behavior.mjs <repo-root>. tests/run.mjs imports and awaits runBehaviorChecks(root).
import assert from "node:assert/strict";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const AI_CONTROL = Symbol.for("my-omp-harness.behavior.ai");
const PROGRESS = Symbol.for("my-omp-harness.progress");
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
const CIRCLE = "\u25CF";
const DOT = "\u00B7";
const MINUS = "\u2212";
const LITERAL = "keep <todo>literal</todo> <todo_context>literal</todo_context> <todo-reminder>literal</todo-reminder> intact";
const MAIN_INIT = { op: "init", list: [{ phase: "Main phase", items: [{ title: "Main-only item", plan: ["main step"] }] }] };
const CHILD_INIT = { op: "init", list: [{ phase: "Child phase", items: [{ title: "Child-only item", plan: ["child step"] }] }] };

// Test-only exports appended to these sources at load time; production files export nothing extra.
const TEST_EXPORTS = {
	"extensions/rg.ts": "readTextBody, renderContent",
	"extensions/cursor-feed/tools.ts": "rowLine, groupLines, bodyOfCall",
};
// Bun provides import.meta.dir to these sources; Node provides import.meta.dirname.
const PRELUDE = "import.meta.dir ??= import.meta.dirname;\n";

// Each stub exports only the names the graph imports. Behavior covers what the ASCII logic checks need.
const STUBS = {
	"@oh-my-pi/pi-coding-agent": String.raw`
export class AssistantMessageComponent {}
export class ReadToolGroupComponent {}
export class StatusLineComponent {
	setGoalModeStatus(_status) {}
}
export class ToolExecutionComponent {}
export class UserMessageComponent {}
export class InteractiveMode {
	// The test sets runGoalCommand on the instance; the harness wraps this method.
	async handleGoalModeCommand(...args) {
		return this.runGoalCommand(...args);
	}
}
`,
	"@oh-my-pi/pi-tui": String.raw`
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
export class Container {}
export class MetricRow {}
export class Spacer {}
export class Text {}
export const theme = { fg: (_color, text) => text };
export const visibleWidth = text => [...text.replace(ANSI, "")].length;
export function replaceTabs(text) {
	return text.replace(/\t/g, "   ");
}
export function truncateToWidth(text, width, ellipsis = "", pad = false) {
	const chars = [...text];
	if (chars.length <= width) return pad ? text + " ".repeat(width - chars.length) : text;
	return chars.slice(0, Math.max(0, width - [...ellipsis].length)).join("") + ellipsis;
}
export function wrapTextWithAnsi(text, width) {
	if (width < 1) return [];
	const rows = [];
	let rest = text;
	while (rest.length > width) {
		let cut = rest.lastIndexOf(" ", width);
		if (cut <= 0) cut = width;
		rows.push(rest.slice(0, cut).trimEnd());
		rest = rest.slice(cut).trimStart();
	}
	rows.push(rest);
	return rows;
}
`,
	"@oh-my-pi/pi-tui/chrome": "export class TranscriptContainer {}\n",
	"@oh-my-pi/pi-tui/native/state": "export function isNativeRendering() {\n\treturn false;\n}\n",
	"@oh-my-pi/pi-tui/tools": "export const toolRenderers = {};\n",
	"@oh-my-pi/pi-natives": String.raw`
export async function glob() {
	throw new Error("pi-natives glob is not stubbed for behavior checks");
}
export async function grep() {
	throw new Error("pi-natives grep is not stubbed for behavior checks");
}
`,
	"@oh-my-pi/pi-ai": String.raw`
export async function completeSimple(model, context) {
	const control = globalThis[Symbol.for("my-omp-harness.behavior.ai")];
	control.calls.push({ model: model.id, system: context.systemPrompt });
	if (control.queue.length === 0) throw new Error("completeSimple called without a queued answer");
	return { content: [{ type: "text", text: control.queue.shift() }] };
}
`,
};
const stubUrl = specifier => `data:text/javascript,${encodeURIComponent(STUBS[specifier])}`;

// zod only builds schemas here; the checks call execute directly, so every builder is a chainable placeholder.
const zodChain = new Proxy(() => {}, { get: () => zodChain, apply: () => zodChain });

function isFile(url) {
	try {
		return statSync(fileURLToPath(url)).isFile();
	} catch {
		return false;
	}
}

function registerLoader(root) {
	return registerHooks({
		resolve(specifier, context, nextResolve) {
			if (specifier.startsWith("@oh-my-pi/")) {
				if (STUBS[specifier] === undefined) throw new Error(`no test stub for ${specifier}`);
				return { url: stubUrl(specifier), shortCircuit: true };
			}
			if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
				const target = new URL(specifier, context.parentURL).href;
				const found = [target, `${target}.ts`, `${target}/index.ts`].find(isFile);
				if (found !== undefined) return { url: found, shortCircuit: true };
			}
			return nextResolve(specifier, context);
		},
		load(url, context, nextLoad) {
			if (!url.startsWith("file:") || !url.endsWith(".ts")) return nextLoad(url, context);
			const file = fileURLToPath(url);
			const names = TEST_EXPORTS[relative(root, file).split(sep).join("/")];
			const body = stripTypeScriptTypes(readFileSync(file, "utf8"));
			return {
				format: "module",
				source: `${PRELUDE}${body}${names === undefined ? "" : `\nexport { ${names} };\n`}`,
				shortCircuit: true,
			};
		},
	});
}

async function loadModules(base) {
	const load = rel => import(pathToFileURL(join(base, rel)).href);
	return {
		base,
		coding: await import(stubUrl("@oh-my-pi/pi-coding-agent")),
		rg: await load("extensions/rg.ts"),
		cards: await load("extensions/cursor-feed/cards.ts"),
		tools: await load("extensions/cursor-feed/tools.ts"),
		harness: (await load("extensions/harness.ts")).default,
		todo: (await load("extensions/todo.ts")).default,
		decisions: (await load("extensions/decisions.ts")).default,
	};
}

function fakeApi() {
	const handlers = {};
	const tools = {};
	const sent = [];
	const api = {
		zod: new Proxy({}, { get: () => zodChain }),
		on(event, handler) {
			(handlers[event] ??= []).push(handler);
		},
		registerTool(def) {
			tools[def.name] = def;
		},
		registerCommand() {},
		getActiveTools: async () => ["read", "bash", "edit", "write"],
		getAllTools: async () => ["read", "bash", "edit", "write", "grep", "lsp", "ast_grep", "goal", "todo"],
		setActiveTools: async () => {},
		sendUserMessage: (...args) => {
			sent.push(args);
		},
		sendMessage() {},
		appendEntry() {},
		getSessionName: () => undefined,
		setSessionName: async () => {},
	};
	return { api, handlers, tools, sent };
}

const fire = async (bound, event, payload, ctx) => {
	for (const handler of bound.handlers[event] ?? []) await handler(payload, ctx);
};
const handlerOf = (bound, event) => {
	const [handler] = bound.handlers[event] ?? [];
	assert.ok(handler, `no ${event} handler was registered`);
	return handler;
};
const contextOf = async (bound, ctx, messages) => {
	const result = await handlerOf(bound, "context")({ messages }, ctx);
	return result?.messages ?? messages;
};
const textOf = message => (typeof message.content === "string" ? message.content : message.content.map(part => part.text ?? "").join(""));
const plain = text => text.replace(ANSI, "");
const cells = text => [...plain(text)].length;

async function readChecks(check, { rg }) {
	const TWO_LINES = "alpha\nbeta\n";
	await check("rg: read past the end of a two-line file is an explicit error", () => {
		const r = rg.readTextBody(TWO_LINES, 11, "two.txt", { start: 3 });
		assert.equal(r.error, true);
		assert.match(r.text, /past the end/);
		assert.doesNotMatch(r.text, /alpha/);
	});
	await check("rg: read from line 1 returns both lines", () => {
		const r = rg.readTextBody(TWO_LINES, 11, "two.txt", { start: 1 });
		assert.notEqual(r.error, true);
		assert.match(r.text, /alpha\nbeta/);
	});
	await check("rg: negative offset reads the last line", () => {
		const r = rg.readTextBody(TWO_LINES, 11, "two.txt", { start: 1, offsetNeg: 1 });
		assert.notEqual(r.error, true);
		assert.match(r.text, /beta/);
	});
	await check("rg: an empty file reads as empty", () => {
		assert.equal(rg.readTextBody("", 0, "empty.txt", { start: 1 }).text, "File is empty.");
	});

	const LONG = `needle${"x".repeat(99994)}`;
	const FILE_TEXT = `${LONG}\nneedle second-match\n`;
	const big = {
		path: "big.txt",
		abs: "/work/big.txt",
		count: 2,
		groups: [
			{ line: 1, entries: [{ lineNumber: 1, line: LONG }] },
			{ line: 2, entries: [{ lineNumber: 2, line: "needle second-match" }] },
		],
	};
	const BUDGET = 99_700; // 100000 minus the footer reserve, with an empty working directory
	await check("rg: an oversized first match carries a recovery note within the budget", () => {
		const first = rg.renderContent([big], 0, Infinity, BUDGET);
		const text = first.lines.join("\n");
		assert.ok(text.length <= BUDGET, `output is ${text.length} chars`);
		assert.equal(first.taken, 1);
		assert.ok(
			/read path=big\.txt offset=1 limit=1 to see lines 1-1\]/.test(text),
			`no recovery note for line 1; tail=${JSON.stringify(text.slice(-160))}`,
		);
	});
	await check("rg: the recovery note's path, offset and limit read back the cut line", () => {
		const text = rg.renderContent([big], 0, Infinity, BUDGET).lines.join("\n");
		const note = /read path=(\S+) offset=(\d+) limit=(\d+) to see lines (\d+)-(\d+)\]/.exec(text);
		assert.ok(note, "no recovery note");
		const [, path, offset, limit, lo, hi] = note;
		assert.equal(path, "big.txt");
		assert.ok(Number(offset) <= Number(lo) && Number(offset) + Number(limit) - 1 >= Number(hi), `offset ${offset} limit ${limit} do not cover ${lo}-${hi}`);
		const read = rg.readTextBody(FILE_TEXT, Buffer.byteLength(FILE_TEXT), path, { start: Number(offset), limit: Number(limit) });
		assert.notEqual(read.error, true);
		assert.match(read.text, /^needle/);
	});
	await check("rg: the match after an oversized first match is reached by offset 1", () => {
		const later = rg.renderContent([big], 1, Infinity, BUDGET);
		assert.ok(later.lines.some(line => line.includes("needle second-match")), JSON.stringify(later.lines));
		assert.equal(later.taken, 1);
	});

	// The bash footer names the directory the call ran in: its own cwd when it has one, else the workspace.
	const FOOTER_CASES = [
		["absolute", "/other", resolve("/other")],
		["relative", "subdir", resolve("/workspace", "subdir")],
		["URI", "local://folder", "local://folder"],
	];
	for (const [label, cwd, expected] of FOOTER_CASES) {
		await check(`rg bash footer: ${label} call cwd is named as the call's directory`, async () => {
			const api = fakeApi();
			rg.default(api.api);
			const event = {
				toolName: "bash",
				input: { command: "make", cwd },
				isError: true,
				content: [{ type: "text", text: "hello" }],
				details: { wallTimeMs: 12.4, exitCode: 2 },
			};
			const result = await handlerOf(api, "tool_result")(event, { cwd: "/workspace" });
			assert.ok(result, "no footer result");
			assert.equal(result.isError, true);
			assert.deepEqual(result.details, event.details);
			const text = textOf(result);
			assert.ok(text.startsWith("Exit code: 2\n\nCommand output:\n\n```\nhello\n```\n\nCommand completed in 12 ms.\n\n"), JSON.stringify(text));
			assert.ok(text.split("\n").includes(`Working directory for this call: ${expected}`), JSON.stringify(text.slice(-200)));
			assert.ok(!text.includes("Current directory: /workspace"), "footer names the workspace for a call that ran elsewhere");
		});
	}
}

async function cardChecks(check, { cards }) {
	const OBJECTIVE = "## Objective\nAlpha\n\n## Boundaries\nPreserve Beta\n## Review\nSpotty";
	for (const expanded of [false, true]) {
		await check(`cards: goal create card keeps the complete objective, expanded=${expanded}`, () => {
			const rows = cards.goalToolLines({ op: "create", objective: OBJECTIVE }, [], "done", expanded, 80).map(plain);
			assert.deepEqual(rows.slice(1).map(row => row.trim()), OBJECTIVE.split("\n"));
		});
	}
	for (const width of [8, 3, 1]) {
		await check(`cards: user goal card keeps every body character at width ${width}`, () => {
			const rows = cards.userGoalCard(`Define goal: ${ALPHABET}`, width, false).map(plain);
			for (const row of rows) assert.ok(cells(row) <= width, `${JSON.stringify(row)} is wider than ${width}`);
			assert.equal(rows.slice(2).map(row => row.trimStart()).join(""), ALPHABET);
		});
	}
}

async function rowChecks(check, { tools }) {
	const action = (verb, detail, extra = {}) => ({ row: { verb, detail, files: 0, searches: 0, ...extra }, status: "done", durationMs: 1200, tool: "read" });
	const EDIT_PATH = "src/a/very/long/path/to/some-file-name.ts";
	const MESSY = "alpha\nbeta\tgamma\u2028delta\u2029eps\rzeta";
	await check("rowLine: an empty detail keeps its elapsed time when the time fits", () => {
		const out = plain(tools.rowLine(action("Searching the workspace", ""), true, 16));
		assert.ok(out.endsWith(` ${DOT} 1.2s`), JSON.stringify(out));
		assert.ok(cells(out) <= 16, JSON.stringify(out));
	});
	await check("rowLine: an empty detail shows its time at full width", () => {
		assert.equal(plain(tools.rowLine(action("Read", ""), true, 120)), `${CIRCLE} Read ${DOT} 1.2s`);
	});
	await check("rowLine: an empty detail at width 8 or 9 is the circle, a space and the time in every status", () => {
		for (const status of ["done", "running", "error"]) {
			for (const width of [8, 9]) {
				const out = plain(tools.rowLine({ ...action("Searching the workspace", ""), status }, true, width));
				assert.equal(out, `${CIRCLE} ${DOT} 1.2s`, `${status} width ${width}: ${JSON.stringify(out)}`);
				assert.ok(cells(out) <= width, `${status} width ${width}: ${JSON.stringify(out)}`);
			}
		}
	});
	await check("rowLine: a long detail keeps the diff counts and time", () => {
		const out = plain(tools.rowLine(action("Edited", EDIT_PATH, { added: 12, removed: 3 }), true, 30));
		assert.ok(out.endsWith(` +12 ${MINUS}3 ${DOT} 1.2s`), JSON.stringify(out));
		assert.ok(cells(out) <= 30, JSON.stringify(out));
	});
	await check("rowLine: at width 12 the edit metadata is whole, and at width 8 it leads ahead of the verb and path", () => {
		const edit = { ...action("Edited", EDIT_PATH, { added: 2, removed: 1 }), tool: "edit", durationMs: 1400 };
		assert.equal(plain(tools.rowLine(edit, true, 12)), `+2 ${MINUS}1 ${DOT} 1.4s`);
		const narrow = plain(tools.rowLine(edit, true, 8));
		assert.ok(cells(narrow) <= 8, JSON.stringify(narrow));
		assert.ok(narrow.includes("+2") && narrow.includes(`${MINUS}1`), JSON.stringify(narrow));
		assert.doesNotMatch(narrow, /Edit|src\//, JSON.stringify(narrow));
		for (const width of [1, 0]) {
			const out = plain(tools.rowLine(edit, true, width));
			assert.ok(cells(out) <= width, `width ${width}: ${JSON.stringify(out)}`);
		}
	});
	await check("rowLine: no row draws past widths 120, 24, 8 or 1", () => {
		const actions = [
			action("Searching the workspace", ""),
			action("Edited", EDIT_PATH, { added: 12, removed: 3 }),
			action("Ran", "npm test -- --filter a very long command"),
		];
		for (const width of [120, 24, 8, 1]) {
			for (const act of actions) {
				const out = plain(tools.rowLine(act, true, width));
				assert.ok(cells(out) <= width, `width ${width}: ${JSON.stringify(out)}`);
			}
		}
	});
	await check("rowLine: line breaks and tabs in a detail make one physical row", () => {
		for (const width of [120, 24]) {
			const out = tools.rowLine(action("Ran", MESSY), true, width);
			assert.doesNotMatch(out, /[\n\r\t\u2028\u2029]/);
			assert.ok(cells(out) <= width, `width ${width}: ${JSON.stringify(out)}`);
		}
		assert.match(plain(tools.rowLine(action("Ran", MESSY), true, 120)), /alpha\s+beta\s+gamma\s+delta\s+eps\s+zeta/);
	});
	await check("rowLine: the raw detail of its action is unchanged", () => {
		const act = action("Ran", MESSY);
		tools.rowLine(act, true, 24);
		assert.equal(act.row.detail, MESSY);
	});
	await check("rowLine: a client.ts basename keeps its full stats and time at width 24, with the verb dropped", () => {
		const edit = { ...action("Edited", "src/app/client.ts", { added: 2, removed: 1 }), tool: "edit" };
		assert.equal(plain(tools.rowLine(edit, true, 24)), `${CIRCLE} client.ts +2 ${MINUS}1 ${DOT} 1.2s`);
	});
	await check("rowLine: a long basename at width 24 keeps a suffix of the name, drops the verb and keeps the time", () => {
		const longFile = "/var/folders/harness-review/probe/packages/very-long-component-directory-name-for-width-checks/nested-long-file-name.ts";
		const edit = { ...action("Edited", longFile, { added: 2, removed: 1 }), tool: "edit", durationMs: 1400 };
		assert.equal(plain(tools.rowLine(edit, true, 24)), `${CIRCLE} \u2026-name.ts +2 ${MINUS}1 ${DOT} 1.4s`);
	});
	const SEVEN_LINES = Array.from({ length: 7 }, (_, index) => `line ${index + 1}`).join("\n");
	for (const toolName of ["read", "grep", "glob", "find", "probe_unknown_tool"]) {
		await check(`bodyOfCall: expanded ${toolName} shows the last six of seven output lines`, () => {
			const call = { toolName, args: {}, results: [{ content: [{ type: "text", text: SEVEN_LINES }] }], isPartial: false };
			assert.deepEqual(tools.bodyOfCall(call).map(plain), ["line 2", "line 3", "line 4", "line 5", "line 6", "line 7"]);
		});
	}
	const ERROR_LINES = Array.from({ length: 7 }, (_, index) => `error ${index + 1}`).join("\n");
	for (const toolName of ["edit", "ast_edit", "apply_patch"]) {
		await check(`bodyOfCall: expanded ${toolName} error with no diff shows the last six of seven error lines`, () => {
			const call = { toolName, args: {}, results: [{ content: [{ type: "text", text: ERROR_LINES }], isError: true }], isPartial: false };
			assert.deepEqual(tools.bodyOfCall(call).map(plain), ["error 2", "error 3", "error 4", "error 5", "error 6", "error 7"]);
		});
	}
	await check("groupLines: the Explored header keeps its elapsed time when it fits and never overflows", () => {
		const owner = {};
		const run = [{ component: owner, actions: [{ ...action("Read", EDIT_PATH, { files: 1 }), durationMs: 1400 }], error: false }];
		for (const width of [1, 8, 24, 80]) {
			const lines = tools.groupLines(owner, run, width).map(plain);
			for (const line of lines) assert.ok(cells(line) <= width, `width ${width}: ${JSON.stringify(line)}`);
			if (cells(` ${DOT} 1.4s`) <= width) assert.ok(lines[0].endsWith(` ${DOT} 1.4s`), `width ${width}: ${JSON.stringify(lines[0])}`);
		}
	});
	await check("groupLines: a collapsed header at width 6 is the raw time, and at 8 or 9 the circle and the time, within bounds", () => {
		const owner = {};
		const run = [{ component: owner, actions: [action("Searching the workspace", "")], error: false }];
		for (const [width, expected] of [
			[6, `${DOT} 1.2s`],
			[8, `${CIRCLE} ${DOT} 1.2s`],
			[9, `${CIRCLE} ${DOT} 1.2s`],
		]) {
			const lines = tools.groupLines(owner, run, width).map(plain);
			assert.deepEqual(lines, [expected], `width ${width}: ${JSON.stringify(lines)}`);
			for (const line of lines) assert.ok(cells(line) <= width, `width ${width}: ${JSON.stringify(line)}`);
		}
	});
}

async function harnessChecks(check, { coding, harness }) {
	const bindPair = () => {
		const main = fakeApi();
		const sub = fakeApi();
		harness(main.api);
		harness(sub.api);
		return { main, sub };
	};
	// The status line setter is how the harness learns the Main goal session that it resumes later.
	const captureGoal = () => {
		const goal = {
			isStreaming: false,
			resumes: 0,
			getGoalModeState: () => ({ goal: { status: "paused" } }),
			goalRuntime: {
				resumeGoal: async () => {
					goal.resumes++;
				},
			},
			sendGoalModeContext: async () => {},
		};
		coding.StatusLineComponent.prototype.setGoalModeStatus.call({ session: goal }, "paused");
		return goal;
	};
	const ctxOf = (name, live, mode) => ({
		agent: { kind: name, id: name, name, depth: name === "main" ? 0 : 1 },
		cwd: ".",
		hasUI: name === "main",
		ui: {
			onTerminalInput: () => {
				live.add(name);
				return () => live.delete(name);
			},
			notify() {},
		},
		setTimeout: fn => fn(),
		sessionManager: { getSessionId: () => `${name}-session`, buildSessionContext: () => ({ mode }), getBranch: () => [] },
	});
	const mainCtx = live => ctxOf("main", live, "goal_paused");
	const subCtx = live => ctxOf("sub", live, "none");
	// Stands in for the interactive mode; the session id matches the Main context so the wrapper tracks it.
	const commandMode = () => Object.assign(new coding.InteractiveMode(), { session: { sessionManager: { getSessionId: () => "main-session" } } });
	const toolCall = (bound, ctx) => fire(bound, "tool_call", { toolName: "read", input: {} }, ctx);
	const pause = (bound, ctx) => fire(bound, "goal_updated", { goal: { status: "paused" } }, ctx);
	const typed = (bound, ctx, text) => fire(bound, "input", { text, source: "interactive", images: [] }, ctx);

	await check("harness: a child session_start keeps the root keyboard subscription", async () => {
		const { main, sub } = bindPair();
		const live = new Set();
		await fire(main, "session_start", {}, mainCtx(live));
		await fire(sub, "session_start", {}, subCtx(live));
		assert.deepEqual([...live], ["main"]);
	});

	await check("harness: the root goal resumes after a child session starts", async () => {
		const { main, sub } = bindPair();
		const live = new Set();
		const goal = captureGoal();
		await fire(main, "session_start", {}, mainCtx(live));
		await fire(sub, "session_start", {}, subCtx(live));
		await toolCall(main, mainCtx(live));
		assert.equal(goal.resumes, 1);
	});

	await check("harness: an owner pause made during a /goal command stays owner-paused", async () => {
		const { main } = bindPair();
		const live = new Set();
		const goal = captureGoal();
		const ctx = mainCtx(live);
		await fire(main, "session_start", {}, ctx);
		const mode = commandMode();
		mode.runGoalCommand = () => pause(main, ctx);
		await mode.handleGoalModeCommand("");
		await toolCall(main, ctx);
		assert.equal(goal.resumes, 0);
	});

	await check("harness: overlapping /goal commands keep owner scope until the last one settles", async () => {
		const { main } = bindPair();
		const live = new Set();
		const goal = captureGoal();
		const ctx = mainCtx(live);
		await fire(main, "session_start", {}, ctx);
		const mode = commandMode();
		const gates = [];
		mode.runGoalCommand = () => new Promise(resolve => gates.push(resolve));
		const first = mode.handleGoalModeCommand("first");
		const second = mode.handleGoalModeCommand("second");
		await new Promise(resolve => setImmediate(resolve));
		assert.equal(gates.length, 2);
		gates[0]();
		await first;
		await pause(main, ctx); // the second command is still pending
		await toolCall(main, ctx);
		assert.equal(goal.resumes, 0);
		gates[1]();
		await second;
		await pause(main, ctx);
		await toolCall(main, ctx);
		assert.equal(goal.resumes, 1);
	});

	await check("harness: a canceled /goal menu leaves a later pause free to auto-resume", async () => {
		const { main } = bindPair();
		const live = new Set();
		const goal = captureGoal();
		const ctx = mainCtx(live);
		await fire(main, "session_start", {}, ctx);
		await typed(main, ctx, "/goal");
		const mode = commandMode();
		mode.runGoalCommand = async () => {}; // canceled: no goal_updated
		await mode.handleGoalModeCommand("");
		await pause(main, ctx);
		await toolCall(main, ctx);
		assert.equal(goal.resumes, 1);
	});

	await check("harness: a /goal command that throws releases its owner scope", async () => {
		const { main } = bindPair();
		const live = new Set();
		const goal = captureGoal();
		const ctx = mainCtx(live);
		await fire(main, "session_start", {}, ctx);
		await typed(main, ctx, "/goal");
		const mode = commandMode();
		mode.runGoalCommand = async () => {
			throw new Error("menu failed");
		};
		await assert.rejects(mode.handleGoalModeCommand(""), /menu failed/);
		await pause(main, ctx);
		await toolCall(main, ctx);
		assert.equal(goal.resumes, 1);
	});

	await check("harness: child input and goal events do not take the root's pending follow-up", async () => {
		const { main, sub } = bindPair();
		const live = new Set();
		await fire(main, "session_start", {}, mainCtx(live));
		await typed(main, mainCtx(live), "keep going");
		await typed(sub, subCtx(live), "child note");
		await fire(sub, "goal_updated", { goal: { status: "active" } }, subCtx(live));
		assert.deepEqual(main.sent, []);
		await fire(main, "goal_updated", { goal: { status: "active" } }, mainCtx(live));
		assert.deepEqual(main.sent, [["keep going"]]);
	});
}

async function todoChecks(check, { todo, base }) {
	const slot = globalThis[PROGRESS];
	const widget = [];
	slot.setTodos = phases => {
		widget.push(phases);
	};
	const bindTodo = () => {
		const main = fakeApi();
		const child = fakeApi();
		todo(main.api);
		todo(child.api);
		return { main, child };
	};
	const mainCtx = {
		agent: { kind: "main", id: "main", name: "main", depth: 0 },
		cwd: base,
		hasUI: true,
		sessionManager: { getBranch: () => [], getSessionId: () => "todo-main" },
	};
	const childCtx = {
		agent: { kind: "sub", id: "child", name: "child", depth: 1 },
		cwd: base,
		hasUI: false,
		sessionManager: { getBranch: () => [], getSessionId: () => "todo-child" },
	};
	const exec = (bound, ctx, op) => bound.tools.todo.execute("call", { ops: [op] }, undefined, undefined, ctx);

	await check("todo: main init publishes its list, starts the first item and shows progress", async () => {
		const { main } = bindTodo();
		const before = widget.length;
		const result = await exec(main, mainCtx, MAIN_INIT);
		assert.notEqual(result.isError, true);
		assert.equal(result.details.phases[0].tasks[0].status, "in_progress");
		assert.equal(widget.length, before + 1);
		assert.equal(slot.state?.item, "Main-only item");
	});

	await check("todo: a child commit keeps its own list and leaves main progress and widget alone", async () => {
		const { main, child } = bindTodo();
		await exec(main, mainCtx, MAIN_INIT);
		const before = widget.length;
		const result = await exec(child, childCtx, CHILD_INIT);
		assert.notEqual(result.isError, true);
		assert.deepEqual(result.details.phases.map(phase => phase.name), ["Child phase"]);
		assert.equal(slot.state?.item, "Main-only item");
		assert.equal(widget.length, before);
	});

	await check("todo: the main context shows only the main list after a child commit", async () => {
		const { main, child } = bindTodo();
		await exec(main, mainCtx, MAIN_INIT);
		await exec(child, childCtx, CHILD_INIT);
		const out = await contextOf(main, mainCtx, [{ role: "user", content: "next step", timestamp: 10 }]);
		const note = textOf(out.at(-1));
		assert.match(note, /Main-only item/);
		assert.doesNotMatch(note, /Child-only item/);
	});

	await check("todo: context keeps literal todo tags in user, tool and assistant messages", async () => {
		const { main } = bindTodo();
		await exec(main, mainCtx, MAIN_INIT);
		const input = [
			{ role: "user", content: LITERAL, timestamp: 1 },
			{ role: "toolResult", toolCallId: "read-1", toolName: "read", content: [{ type: "text", text: LITERAL }], isError: false, timestamp: 2 },
			{ role: "assistant", content: [{ type: "text", text: LITERAL }], timestamp: 3 },
		];
		const out = await contextOf(main, mainCtx, input);
		assert.deepEqual(out.slice(0, 3), input);
	});

	await check("todo: context keeps the real todo.ts source text intact", async () => {
		const { main } = bindTodo();
		await exec(main, mainCtx, MAIN_INIT);
		const source = readFileSync(join(base, "extensions/todo.ts"), "utf8");
		const [copy] = await contextOf(main, mainCtx, [
			{ role: "toolResult", toolCallId: "read-2", toolName: "read", content: [{ type: "text", text: source }], isError: false, timestamp: 4 },
		]);
		assert.equal(textOf(copy), source);
	});

	await check("todo: context removes only the generated todo block from the native goal context", async () => {
		const { main } = bindTodo();
		await exec(main, mainCtx, MAIN_INIT);
		const native = {
			role: "custom",
			customType: "goal-mode-context",
			attribution: "agent",
			content: "Goal: ship it <todo_context>\nold list\n</todo_context> done",
			timestamp: 5,
		};
		const [kept] = await contextOf(main, mainCtx, [native]);
		assert.match(textOf(kept), /^Goal: ship it\s+done$/);
	});

	await check("todo: the context appends its own todo note exactly once", async () => {
		const { main } = bindTodo();
		await exec(main, mainCtx, MAIN_INIT);
		const out = await contextOf(main, mainCtx, [{ role: "user", content: LITERAL, timestamp: 6 }]);
		const notes = out.filter(message => message.attribution === "agent" && textOf(message).includes("<todo>"));
		assert.equal(notes.length, 1);
		assert.equal(out.at(-1), notes[0]);
	});

	await check("todo: session stop blocks on the main list and never on a child list", async () => {
		const { main, child } = bindTodo();
		await exec(main, mainCtx, MAIN_INIT);
		await exec(child, childCtx, CHILD_INIT);
		const stop = await handlerOf(main, "session_stop")({}, mainCtx);
		assert.equal(stop?.decision, "block");
		assert.match(stop.reason, /Main-only item/);
		assert.equal(await handlerOf(child, "session_stop")({}, childCtx), undefined);
	});
}

async function decisionChecks(check, { decisions }) {
	const ai = { queue: [], calls: [] };
	globalThis[AI_CONTROL] = ai;
	const DECISION = "Approved decision: Chosen rule";
	const FINAL = `yes\n\n${DECISION}`;
	const PROPOSAL = {
		role: "assistant",
		content: [{ type: "text", text: "Proposal: Chosen rule or Other rule. Reply with the option." }],
		stopReason: "stop",
		timestamp: 1,
	};
	const OWNER = { role: "user", content: "yes", timestamp: 2 };
	const FILTER = JSON.stringify({ decision: true });
	const RECORD = JSON.stringify({ changes: [{ op: "add", text: "Chosen rule", quote: "yes", confirmed: "Chosen rule" }] });
	const bindDecisions = () => {
		const api = fakeApi();
		decisions(api.api);
		return api;
	};
	const ctxOf = branch => ({
		agent: { kind: "main", id: "main", name: "main", depth: 0 },
		mode: "tui",
		cwd: ".",
		hasUI: true,
		abort() {},
		ui: { notify() {} },
		modelRegistry: {
			find: (_provider, id) => ({ id }),
			getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "test-key", headers: {} }),
		},
		sessionManager: { getBranch: () => branch, getSessionId: () => "decisions-session", getSessionFile: () => null },
	});
	const reset = (...answers) => {
		ai.calls.length = 0;
		ai.queue.splice(0, ai.queue.length, ...answers);
	};

	await check("decisions: an approved proposal is saved with its message and replays without a new check", async () => {
		const d = bindDecisions();
		const branch = [{ type: "message", message: PROPOSAL }];
		const ctx = ctxOf(branch);
		d.api.appendEntry = (customType, data) => {
			branch.push({ type: "custom", customType, data });
		};
		reset(FILTER, RECORD);
		await fire(d, "session_start", {}, ctx);
		const [sent] = await contextOf(d, ctx, [OWNER]);
		assert.equal(textOf(sent), FINAL);
		assert.equal(ai.calls.length, 2);
		const saved = branch.at(-1);
		assert.equal(saved.customType, "my-omp-harness.decisions");
		assert.equal(saved.data.finalText, FINAL);
		assert.equal(typeof saved.data.messageKey, "string");
		branch.push({ type: "message", message: OWNER });
		await fire(d, "session_switch", {}, ctx);
		const [replayed] = await contextOf(d, ctx, [OWNER]);
		assert.equal(textOf(replayed), FINAL);
		assert.equal(ai.calls.length, 2);
	});

	await check("decisions: a legacy registry without saved message keys still lists its decisions and is not rechecked", async () => {
		const d = bindDecisions();
		const branch = [
			{ type: "message", message: PROPOSAL },
			{ type: "message", message: OWNER },
			{
				type: "custom",
				customType: "my-omp-harness.decisions",
				data: {
					registry: [{ id: "D1", text: "Chosen rule", quote: "yes", confirmed: "Chosen rule", cancelled: false }],
					applied: [{ op: "add", id: "D1", text: "Chosen rule", confirmed: "Chosen rule" }],
				},
			},
		];
		const ctx = ctxOf(branch);
		reset();
		await fire(d, "session_start", {}, ctx);
		const out = await contextOf(d, ctx, [OWNER]);
		assert.equal(ai.calls.length, 0);
		assert.match(textOf(out.at(-1)), /D1\. Chosen rule/);
	});
}

export async function runBehaviorChecks(root) {
	const base = resolve(root);
	const addedBun = globalThis.Bun === undefined;
	if (addedBun) globalThis.Bun = { which: () => null }; // harness reads Bun.which while it loads
	const hooks = registerLoader(base);
	const failed = [];
	let passed = 0;
	const check = async (name, body) => {
		try {
			await body();
			passed++;
			console.log(`ok - ${name}`);
		} catch (error) {
			failed.push(name);
			const message = error instanceof Error ? error.message : String(error);
			console.log(`not ok - ${name}: ${message.replace(/\s+/g, " ").slice(0, 300)}`);
		}
	};
	try {
		const env = await loadModules(base);
		await readChecks(check, env);
		await cardChecks(check, env);
		await rowChecks(check, env);
		await harnessChecks(check, env);
		await todoChecks(check, env);
		await decisionChecks(check, env);
	} finally {
		hooks.deregister?.();
		if (addedBun) delete globalThis.Bun;
	}
	console.log(`${passed} passed, ${failed.length} failed`);
	if (failed.length > 0) throw new Error(`behavior checks failed: ${failed.join("; ")}`);
}

if (process.argv[1] !== undefined && realpathSync(resolve(process.argv[1])) === fileURLToPath(import.meta.url)) {
	if (process.argv[2] === undefined) throw new Error("usage: node behavior.mjs <repo-root>");
	await runBehaviorChecks(process.argv[2]);
}
