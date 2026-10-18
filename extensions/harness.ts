import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { homedir } from "node:os";

const ENV_PROGRAMS = ["git", "node", "bun", "npm", "pnpm", "python3", "python", "cargo", "rustc", "go", "java", "docker", "gh", "rg", "fd", "jq", "make", "cmake"];
const ENVIRONMENT = (() => {
	const found = ENV_PROGRAMS.filter(name => Bun.which(name) !== null);
	const home = homedir().replace(/\\/g, "/");
	const winExtra = process.platform === "win32" ? ", never /c/... or backslashes" : "";
	return `Environment: shell: the bash tool runs an embedded bash-compatible shell with built-in grep, sed, find, xargs, jq and coreutils; paths: absolute like ${home}/... with forward slashes${winExtra}; programs on PATH: ${found.length ? found.join(", ") : "none found"}.`;
})();

export default function harness(pi: ExtensionAPI) {
	// Only the tools below are active; a name is kept only when omp lists it among all tools.
	const KEEP = ["read", "grep", "glob", "bash", "edit", "write", "lsp", "ast_grep", "eval"];
	const syncTools = async () => {
		const active = await pi.getActiveTools();
		const all = typeof pi.getAllTools === "function" ? ((await pi.getAllTools()) as (string | { name: string })[]) : undefined;
		const known = all?.map(tool => (typeof tool === "string" ? tool : tool.name));
		const final = KEEP.filter(name => active.includes(name) || known === undefined || known.includes(name));
		if (final.length !== active.length || final.some((name, index) => name !== active[index])) await pi.setActiveTools(final);
	};
	pi.on("session_start", async () => syncTools());
	pi.on("agent_end", async () => syncTools());

	pi.on("before_agent_start", async (event, ctx) => {
		const tools = ENVIRONMENT;
		return {
			systemPrompt: [
				...event.systemPrompt,
				tools,
			],
		};
	});
}
