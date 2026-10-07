---
name: omp-tools
description: "omp tool mechanics: speed through omp features, output limits, safe writes, and shell portability."
hide: true
---

# omp tool mechanics

- Speed comes from omp's own features. Put every independent call in one response. Use `read` comma lists, `glob` with `;`-separated paths, `task` waves, `async` bash, and `local://` files for findings you will need again. Search file contents with the tool the context-gathering rule picks. Before a manual equivalent, use the `xd://` tools: `lsp` for definitions, references, and diagnostics, `ast_grep` for structural search, and `ast_edit` for structural code changes.
- For many reads, searches, or commands whose results need filtering, run one `eval` js cell: start the `tool.<name>` calls together, await them with `Promise.all`, reduce the results in JavaScript, and return only what the next decision needs. Await one call before starting another only when it needs that result.
- A cut-off bash or eval result keeps its full output under `artifact://<id>`. Read only the missing part by line range or grep before relying on the result. Keep default limits for builds, tests, and logs, and filter their output.
- Write files only with `write` and `edit`, never with shell redirection, heredoc, `node -e`, or python. Pass long text to `write` directly; it needs no escaping. Never put long text inside a shell command or a JavaScript string, where one unescaped quote, backtick, or `${` breaks it.
- Edit with the tag of a read made after the file's last change and after the last compaction; otherwise read the region again first.
- Outside the working directory, give absolute paths in the operating system's form: `/Users/...` on macOS, `C:/...` on Windows, never `/c/...`. Use only paths taken from a listing, a search, or a read; when a path may be absent, list its directory first. A bash `cwd` must be an existing directory.
- The bash tool runs an embedded bash-compatible shell whose `grep`, `sed`, `find`, `xargs`, `jq`, and coreutils are built in and behave the same on macOS, Linux, and Windows; other programs, such as python, may be missing. The built-in `jq` is jaq: `.a.b` fails when `.a` is missing, so write `[.a.b?][0]`.
- Filter, slice, count, and parse output in an `eval` js cell rather than long `awk` or `sed` scripts, and call `JSON.parse` only on text known to be JSON, inside `try`. Run a multi-step script as one `eval` cell instead of nesting it in `bash -c`, a heredoc, or a temporary script file.
- Start a long command with `async: true` and keep working; its result arrives on its own. Run a server as a named service with `ready`. Never poll with `sleep`, `ps`, or log tails.
