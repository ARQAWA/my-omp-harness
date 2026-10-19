// The todo op schema, shared by the todo tool and by the optional `todo` field of every other tool.
// The field lets Main keep its list inside its work calls, so the list never costs a response of its own.
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

type Zod = ExtensionAPI["zod"];

const FIELD_NOTE = 'Optional todo ops, the same as the todo tool\'s `ops`, e.g. ["done 1.2", "plan: first | second"]; applied before this response\'s calls run.';

/** The op list of the todo tool. */
export function todoOps(z: Zod) {
	const item = z.union([z.string(), z.object({ title: z.string(), plan: z.array(z.string()).optional() })]);
	const op = z.object({
		op: z.enum(["init", "append", "start", "done", "drop", "block", "unblock", "rm", "plan", "step", "closed"]),
		item: z.string().optional(),
		phase: z.string().optional(),
		list: z.array(z.object({ phase: z.string(), items: z.array(item) })).optional(),
		items: z.array(item).optional(),
		reason: z.string().optional(),
		steps: z.array(z.string()).optional(),
		step: z.number().optional(),
	});
	// An op is a short text like "done 1.2" or the object form; the todo tool's description lists both.
	return z.array(z.union([z.string(), op]));
}

// OMPLITE_TODO=off removes the field together with the todo tool, for the A/B bench.
const OFF = process.env.OMPLITE_TODO === "off";

/**
 * A tool's parameters with the optional `todo` field for Main and without it for a subagent, which keeps no list.
 * `build` gets the extra fields to spread into the schema object; the result is read through the tool's `parameters` getter.
 */
export function todoParameters<T>(pi: ExtensionAPI, build: (extra: Record<string, unknown>) => T): () => T {
	const plain = build({});
	// The field takes text ops only: the object form would cost about 250 schema tokens on every tool in every request.
	const full = OFF ? plain : build({ todo: pi.zod.array(pi.zod.string()).describe(FIELD_NOTE).optional() });
	let main = true;
	pi.on("session_start", (_event, ctx) => {
		main = ctx.agent.kind === "main";
	});
	return () => (main ? full : plain);
}

/** The same for parameters written as plain JSON Schema. */
export function todoJsonParameters<T extends { properties: Record<string, unknown> }>(pi: ExtensionAPI, params: T, finish: (params: T) => unknown): () => unknown {
	return todoParameters(pi, extra => finish({ ...params, properties: { ...params.properties, ...(extra.todo ? { todo: todoFieldJson(pi.zod) } : {}) } }));
}

/** The optional `todo` field for a tool whose parameters are plain JSON Schema. */
export function todoFieldJson(z: Zod): Record<string, unknown> {
	return { type: "array", items: { type: "string" }, description: FIELD_NOTE };
}

/** The parameters without the `todo` field, for a tool that hands them on to a native tool. */
export function withoutTodo<T>(params: T): T {
	if (typeof params !== "object" || params === null || !("todo" in params)) return params;
	const { todo: _todo, ...rest } = params as Record<string, unknown>;
	return rest as T;
}
