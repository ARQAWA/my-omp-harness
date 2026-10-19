# lite: internal design system

This branch is the lite harness for omp: one omp package (`package.json`) plus `SYSTEM.md` and `settings/`. omp loads it straight from this worktree through `extensions`. Every accepted decision with its reason is in `DECISIONS.md`; change a decision only together with its entry there.

## Layout

```text
SYSTEM.md                  rules that span all tools; nothing tool-specific
DECISIONS.md               decisions and bench results
bench/                     per-run bench summaries named in DECISIONS.md
INSTALL.md                 standalone install instructions for an agent
settings/                  config.yml and models.yml of the stand, theme titanium-arq.json, keybindings.yml
agents/                    subagent definitions (not active yet)
omp-vscode/                VS Code extension for Windows: omp in a terminal tab, omp.exe kept at the latest release
skills/                    omp loads them from the package root
  approval/                approval step, off through disabledExtensions in settings/config.yml
  define-goal/             /skill:define-goal, hidden from the model
extensions/
  harness.ts               active tool set, environment line
  autocompaction.ts        compaction thresholds per model
  ui/                      interface from the main harness: status bar, feed, hub, model and reasoning keys
    feed/                  feed modules, loaded through feed.ts and status-bar.ts
  shared/                  code used by more than one tool
    toolset.ts             base and loadable tool names
    search/                search engine and result format of grep and glob
    stop.ts                the one stop handler's checks: subagent wait first, then todo
    todo-ops.ts            todo op schema and the optional `todo` field of Main's work tools
    paths.ts validate.ts locks.ts native.ts
  tools/<name>/
    index.ts               registers the tool
    description.md         the whole model-facing description of the tool
    *.ts                   code only this tool uses
```

## Rules

1. A tool's instructions live only inside the tool: `tools/<name>/description.md`. `index.ts` imports it as text (`import description from "./description.md" with { type: "text" }`), so there is no build step. Parameter descriptions stay in the schema in `index.ts`. `SYSTEM.md` holds only rules that span all tools.
2. One tool, one folder with `index.ts` and `description.md`. Code that two or more tools use goes to `shared/`; code one tool uses stays in its folder. Every tool is listed in `package.json`.
3. Tool names are stock omp and Pi names (`read`, `grep`, `glob`, `bash`, `edit`, `write`, `eval`). A tool that replaces an omp built-in keeps its name and calls the native one through `ctx.invokeTool`; `shared/native.ts` gives it omp's renderers.
4. Base tools sit in every request: `read`, `grep`, `glob`, `bash`, `edit`, `write`, `todo` and `load_tools`. Loadable tools (`eval`, `lsp`, `ast_grep`) reach the model only after it names them in `load_tools`, from its next response to the end of the session. Both lists are in `shared/toolset.ts`; a new tool is loadable unless it is needed in most tasks. Every work tool takes Main's optional `todo` field through `shared/todo-ops.ts` (`todoParameters`, `todoJsonParameters`) and drops it with `withoutTodo` before handing params to a native tool; `custom` and `load_tools` do not take it. All tools register with `loadMode: "essential"`: omp's own `xd://` mounting does not work while `read` and `write` are replaced.
5. `edit` follows the model: GPT models get omp's `apply_patch` text and grammar, other models get the replace mode from `description.md`. Both modes lock each file and refuse a busy one.
6. Every tool is `concurrency: "shared"`, so all calls of one response run at once. Exceptions, each with its reason in a comment next to it: `eval` (one kernel per language holds the session state) and `bash` with `pty` (it owns the terminal).
7. No mentions of other products in code, descriptions or names. The tooling is our own.

## Checks

After a change of a tool, compare what the model receives before and after: the `tools` array of the first provider request (an extension on `before_provider_request` can write it to a file). A change of model-facing text needs the owner's agreement. Run omp on the stand with `HOME=~/stock-bench/omp-lite-home`; `omp-lite-home/.omp/agent/SYSTEM.md` must stay identical to `SYSTEM.md` (`cmp`).
