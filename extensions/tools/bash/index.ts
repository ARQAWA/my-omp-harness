import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { lookup } from "@oh-my-pi/pi-coding-agent/config/registry";
import { nativeRenderers, unavailable } from "../../shared/native.ts";
import description from "./description.md" with { type: "text" };

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
		// A pty command owns the terminal for interactive input, so it runs alone.
		concurrency: (args: { pty?: unknown } | undefined) => (args?.pty === true ? "exclusive" : "shared"),
		description: description.trim(),
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
			if (!ctx.invokeTool) return unavailable("bash");
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
		...nativeRenderers("bash"),
	});
}
