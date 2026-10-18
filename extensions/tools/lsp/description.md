Symbol-aware code intelligence from language servers — navigation, refactors, and diagnostics where text tools miss callsites.

- Use lsp instead of grep when you need every caller of a function or method, the definition or type a symbol resolves to, or every implementation of a trait or interface: grep misses calls through aliases, re-exports and variables, and lists unrelated symbols with the same name.
- Call lsp in the same response as your first grep wave, not after it. `symbols` with `file: "*"` and `query` finds a definition without knowing its file; then `references` or `definition` with `file`, `line` and `symbol`.
- Position-based actions take `file` + `line` + `symbol` (substring; `#N` for Nth match); `line` is 1-indexed. Project-aware lookups fail without `symbol`.
- `rename` applies by default (`apply: false` previews); `rename_file` moves a file and rewrites imports. Never rename across files with edits by hand.
- `code_actions` lists by default; apply one with `apply: true` + `query` (title substring or index).
- `diagnostics`: a path, a glob, or `file: "*"` for the workspace. `hover` gives the type and docs of a symbol.
- `reload` restarts one server (`file`) or all (`*`); `request` sends a raw method in `query` with JSON `payload`.
