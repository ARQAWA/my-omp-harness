import { readFileSync } from "node:fs";
import { join } from "node:path";

// One tool entry as Cursor Desktop sent it (runs-2026-10-16-T4 capture).
export interface CapturedTool {
	name: string;
	description: string;
	parameters: Record<string, unknown>;
}

const TOOLS = JSON.parse(readFileSync(join(import.meta.dir, "cursor-tools.json"), "utf8")) as CapturedTool[];

export function declaration(name: string): CapturedTool {
	const entry = TOOLS.find(tool => tool.name === name);
	if (entry === undefined) throw new Error(`no captured declaration for tool ${name}`);
	return entry;
}
