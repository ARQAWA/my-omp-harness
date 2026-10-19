// One stop handler for Main. omp runs session_stop handlers in turn and the first refusal ends the round, so separate
// handlers could drop each other's results; checks register here and run in priority order, the first text wins.
import type { ExtensionContext } from "@oh-my-pi/pi-coding-agent";

type Check = (ctx: ExtensionContext) => Promise<string | undefined> | string | undefined;

// On globalThis: omp loads every extension file with its own import tag, so each gets its own copy of this module.
const checks: Map<string, { priority: number; check: Check }> = ((globalThis as any).__ompliteStopChecks ??= new Map());

/** Registers a stop check; lower priority runs first. A returned text continues Main with it instead of stopping. */
export function onStop(name: string, priority: number, check: Check): void {
	checks.set(name, { priority, check });
}

/** Runs the checks in priority order and returns the first text, or undefined when Main may stop. */
export async function runStop(ctx: ExtensionContext): Promise<string | undefined> {
	for (const { check } of [...checks.values()].sort((a, b) => a.priority - b.priority)) {
		const text = await check(ctx);
		if (text) return text;
	}
	return undefined;
}
