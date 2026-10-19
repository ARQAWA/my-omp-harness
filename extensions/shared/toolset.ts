// The tool set of the harness. Base tools sit in every request; loadable ones join the request only after the model
// names them in load_tools, and stay for the rest of the session.
// OMPLITE_TOOLS selects the A/B variant: "load" (default) keeps eval, lsp and ast_grep behind load_tools; "base" puts
// them in every request and drops load_tools.
const EXTRA = ["eval", "lsp", "ast_grep"] as const;
const ALL_BASE = process.env.OMPLITE_TOOLS === "base";

// Subagent tools are Main's only; a subagent keeps the tools its role file lists.
// OMPLITE_EXPLORER=off removes codebase_explorer for the A/B bench.
export const SUBAGENT_TOOLS = ["code_writer", "shell_runner", ...(process.env.OMPLITE_EXPLORER === "off" ? [] : ["codebase_explorer"]), "review", "custom"];
// OMPLITE_TODO=off removes todo for the A/B bench.
export const BASE_TOOLS = ["read", "grep", "glob", "bash", "edit", "write", ...(process.env.OMPLITE_TODO === "off" ? [] : ["todo"]), ...(ALL_BASE ? EXTRA : ["load_tools"]), ...SUBAGENT_TOOLS];
export const LOADABLE_TOOLS = EXTRA;

// Loadable tools the model has loaded in this process.
export const loaded = new Set<string>();
