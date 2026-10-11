import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { lookup } from "@oh-my-pi/pi-coding-agent/config/registry";

const BASH_DESCRIPTION =
	"Persistent shell: one fact command/pipeline; dependencies use `&&`.\n" +
	"Scripts/heredocs/`$(…)`/complex pipelines → `eval`.\n" +
	"`cwd`, not `cd`; `pty` only interactive.\n" +
	"Internal URIs work as paths for builtins/coreutils, redirects, globs.\n" +
	"Without `timeout` a command has no deadline and is never killed, also in the background; set `timeout` in seconds to kill it after that time.\n" +
	"`block_until_ms`: how long to wait for a non-`pty` command before it moves to background job `bg_N`; default 60000; 0 starts it in the background at once, like `async: true`. Its result arrives automatically as a follow-up message. NEVER poll.\n" +
	"No `head`/`tail`/redirection; output trunc by default, full result at `artifact://<id>`.\n" +
	"Long-lived services: unique name; ready requires name; no async/timeout; pty defaults true. ready needs log regex or port (both if given); host defaults 127.0.0.1, ready.timeout 30s.";

type NativeResult = { content: { type: string; text?: string }[]; details?: unknown; isError?: boolean };
type BashParams = {
	command: string;
	timeout?: number;
	block_until_ms?: number;
	cwd?: string;
	pty?: boolean;
	async?: boolean;
	name?: string;
	ready?: { log?: string; port?: number; host?: string; timeout?: number };
};

let current: number | undefined;
let lastStart = 0;
let gate: Promise<void> = Promise.resolve();

// GPT sends every optional field with an empty default; "" names and cwd, and a ready block with neither log nor port, count as absent.
function cleanBashParams(raw: BashParams): BashParams {
	const params = { ...raw };
	if (params.name === "") delete params.name;
	if (params.cwd === "") delete params.cwd;
	if (params.timeout === 0) delete params.timeout;
	if (params.ready && !(params.ready.log || (params.ready.port ?? 0) > 0)) {
		delete params.ready;
	} else if (params.ready) {
		const ready = { ...params.ready };
		if (ready.log === "") delete ready.log;
		if (ready.host === "") delete ready.host;
		if (ready.port === 0) delete ready.port;
		if (ready.timeout === 0) delete ready.timeout;
		params.ready = ready;
	}
	return params;
}

export default function (pi: ExtensionAPI) {
	const z = pi.zod;

	const setThreshold = (v: number): Promise<void> => {
		const step = gate.then(async () => {
			if (current !== v) {
				const wait = 50 - (Date.now() - lastStart);
				if (wait > 0) await new Promise<void>(resolve => setTimeout(resolve, wait));
				try {
					lookup("bash.autoBackground.thresholdMs")?.override(pi.pi.settings, v);
				} catch {}
				current = v;
			}
			lastStart = Date.now();
		});
		gate = step.then(
			() => undefined,
			() => undefined,
		);
		return step;
	};

	pi.registerTool({
		name: "bash",
		label: "bash",
		loadMode: "essential",
		approval: "exec",
		concurrency: (args: { pty?: unknown } | undefined) => (args?.pty === true ? "exclusive" : "shared"),
		description: BASH_DESCRIPTION,
		parameters: z.object({
			command: z.string(),
			timeout: z.number().optional().describe("seconds; omitted = no deadline"),
			block_until_ms: z.number().min(0).optional(),
			cwd: z.string().optional(),
			pty: z.boolean().optional(),
			async: z.boolean().optional(),
			name: z.string().optional(),
			ready: z
				.object({
					log: z.string().optional(),
					port: z.number().optional(),
					host: z.string().optional(),
					timeout: z.number().optional(),
				})
				.optional(),
		}),
		async execute(_toolCallId, rawParams, signal, onUpdate, ctx) {
			const params = cleanBashParams(rawParams as BashParams);
			if (!ctx.invokeTool) {
				return {
					content: [{ type: "text" as const, text: "bash is not available to this agent." }],
					isError: true,
				};
			}
			const { block_until_ms: blockUntilMs, ...rest } = params;
			const args: Record<string, unknown> = Object.fromEntries(
				Object.entries(rest).filter(([, value]) => value !== undefined),
			);
			if (params.name === undefined && params.timeout === undefined) args.timeout = 0;

			if (blockUntilMs === 0 && params.pty !== true && params.name === undefined) {
				args.async = true;
				return ctx.invokeTool!(args, { signal, onUpdate });
			}
			if (args.async === true || params.pty === true || params.name !== undefined) {
				return ctx.invokeTool!(args, { signal, onUpdate });
			}

			await setThreshold(Math.floor(blockUntilMs ?? 60000));
			return ctx.invokeTool!(args, { signal, onUpdate }) as Promise<NativeResult>;
		},
	});
}
