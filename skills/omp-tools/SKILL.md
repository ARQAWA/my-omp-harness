---
name: omp-tools
description: "omp tool mechanics: speed through omp features, output limits, the context budget, safe writes, and shell portability."
hide: true
---

# omp tool mechanics

- Speed comes from omp's own features. Put every independent call in one response. Use `read` line ranges and comma lists, `grep` and `glob` with `;`-separated paths and alternation patterns, `task` waves, `async` bash, and `local://` files for findings you will need again. Before a manual equivalent, use the `xd://` tools: `lsp` for definitions, references, and diagnostics, `ast_grep` for structural search, and `ast_edit` for structural code changes.
- For many reads, searches, or commands whose results need filtering, run one `eval` js cell: start the `tool.<name>` calls together, await them with `Promise.all`, reduce the results in JavaScript, and return only what the next decision needs. Await one call before starting another only when it needs that result.
- A cut-off bash or eval result keeps its full output under `artifact://<id>`. Read only the missing part by line range or grep before relying on the result. Keep default limits for builds, tests, and logs, and filter their output.
- A bare `read` of a code file over about 100 lines returns declarations only and names the omissions in its footer. Read the code you rely on with `:raw` or a line range, and re-read only the named omissions. A long text file returns 300 lines per call; its footer names the next line.
- Size only the paths the task needs with `wc -c`, never a whole large repository; estimate one token per four bytes. When those paths plus the deliverable stay under about 150,000 tokens, or 100,000 on Composer, read everything yourself and write once. Otherwise read what fits and give the rest to `enot`: a full context triggers a slow compaction and rereading.
- `enot` does not see your history. Its brief carries the question, the known paths, and the expected answer: facts with exact `file:line` and what stayed unresolved. Put all tasks of one wave in one `task` call. Results arrive on their own: keep working, call `wait` only when blocked, and never poll.
- Write files only with `write` and `edit`, never with shell redirection, heredoc, `node -e`, or python. Pass long text to `write` directly; it needs no escaping. Never put long text inside a shell command or a JavaScript string, where one unescaped quote, backtick, or `${` breaks it.
- Edit with the tag of a read made after the file's last change and after the last compaction; otherwise read the region again first.
- Outside the working directory, give absolute paths in the operating system's form: `/Users/...` on macOS, `C:/...` on Windows, never `/c/...`. Use only paths taken from a listing, a search, or a read; when a path may be absent, list its directory first. A bash `cwd` must be an existing directory.
- The bash tool runs an embedded bash-compatible shell whose `grep`, `sed`, `find`, `xargs`, `jq`, and coreutils are built in and behave the same on macOS, Linux, and Windows; other programs, such as python, may be missing. The built-in `jq` is jaq: `.a.b` fails when `.a` is missing, so write `[.a.b?][0]`.
- Filter, slice, count, and parse output in an `eval` js cell rather than long `awk` or `sed` scripts, and call `JSON.parse` only on text known to be JSON, inside `try`. Run a multi-step script as one `eval` cell instead of nesting it in `bash -c`, a heredoc, or a temporary script file.
- Start a long command with `async: true` and keep working; its result arrives on its own. Run a server as a named service with `ready`. Never poll with `sleep`, `ps`, or log tails.
