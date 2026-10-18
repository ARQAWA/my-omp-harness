// The tool set of the harness. Base tools sit in every request; loadable ones join the request only after the model
// names them in load_tools, and stay for the rest of the session.
// OMPLITE_TOOLS selects the A/B variant: "load" (default) keeps eval, lsp and ast_grep behind load_tools; "base" puts
// them in every request and drops load_tools.
const EXTRA = ["eval", "lsp", "ast_grep"] as const;
const ALL_BASE = process.env.OMPLITE_TOOLS === "base";

export const BASE_TOOLS = ["read", "grep", "glob", "bash", "edit", "write", ...(ALL_BASE ? EXTRA : ["load_tools"])];
export const LOADABLE_TOOLS = EXTRA;

// Loadable tools the model has loaded in this process.
export const loaded = new Set<string>();
