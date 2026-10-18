// The tool set of the harness. Base tools sit in every request; loadable ones join the request only after the model
// names them in load_tools, and stay for the rest of the session.
export const BASE_TOOLS = ["read", "grep", "glob", "bash", "edit", "write", "load_tools"];
export const LOADABLE_TOOLS = ["eval", "lsp", "ast_grep"] as const;

// Loadable tools the model has loaded in this process.
export const loaded = new Set<string>();
