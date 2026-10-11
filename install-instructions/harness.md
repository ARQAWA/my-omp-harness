# The harness package

Order boundaries: [INSTALL_FOR_AGENTS.md](../INSTALL_FOR_AGENTS.md).

## Contents

The package lies at the root of the clone: `package.json` (the `omp.extensions`
and `dependencies` fields), `bun.lock`, `extensions/harness.ts` with the
`/define-goal` procedure in `extensions/define-goal.md`, `extensions/rg.ts`,
`extensions/subagent-model-policy.ts`, `extensions/status-bar.ts`, `extensions/autocompaction.ts`,
`extensions/model-arrows.js`, `extensions/reasoning-arrows.js`,
`extensions/default-model.ts`, `extensions/subagent-reuse.ts`,
`extensions/diagram.ts`, `extensions/cursor-feed.ts` with modules in
`extensions/cursor-feed/`, `extensions/lcm/index.ts` with modules in
`extensions/lcm/src/` and the native module in `extensions/lcm/native/`,
`extensions/write.ts`, `extensions/edit.ts`, `extensions/bash.ts`,
`extensions/ask.ts`, `extensions/todo.ts`, `extensions/results.ts`, `skills/` and
`agents/`. omp loads a directory from the
`extensions` list in `config.yml` as a whole: it takes the extensions from its
`package.json` and finds `skills/` and `agents/` next to it. The dependency of
`diagram.ts`, the `beautiful-mermaid` library, is installed from `bun.lock` into
the clone's `node_modules/`.
The system prompt is a separate component: [system-prompt.md](system-prompt.md).

On every model request (`before_agent_start`), `harness.ts` appends to the
system prompt:

- for root Main, the full `skills/gold-standard/SKILL.md`,
  `skills/omp-tools/SKILL.md`, `skills/main-workflow/SKILL.md`,
  `skills/subagents/SKILL.md` and `skills/clear-communication/SKILL.md`;
- for a subagent, only `skills/omp-tools/SKILL.md`. A subagent keeps the whole
  system prompt, `SYSTEM.md` included, and works from its definition and brief.

Main's tools: `harness.ts` keeps the omp goal tool `goal` enabled;
`diagram.ts` adds `diagram`, a Mermaid diagram as a PNG image across the full
terminal width with the link "Open full size", in herdr through Kitty
graphics. Subagents do not get these tools. `rg.ts` gives all agents, including
`codebase_explorer`, `spotty`, `smarty` and `bossy`, one set of search and read
tools: `glob` (replaces the built-in one; `glob_pattern`, `target_directory`,
`offset`, newest files first, hidden files included, .gitignore applied), `grep`
(replaces the built-in one: content search on the `rg` engine, lines
`path:line:text` that fit `read path:line`, in `<workspace_result>`;
`head_limit` and `offset` count matches, files or entries; `type` also knows
ruby, php, swift, kotlin, html, css, sql and other languages; an invalid regex
is searched as literal text; a path with a URL, for example `history://`,
`artifact://` or `local://`, goes to the native omp `grep`, which takes only
`pattern`, `path` and `-i`) and
`read` (`path`, `offset`, `limit`; every tenth line is numbered, a long file is
cut off with the line `[Use offset=N to continue]`; a line that does not fit
into the output is returned in fragments with the tail
`[Use path=<file>:<line>:chars:<start>+<count> to continue]`, which is passed as
`path`; `path:N` reads from line N; a directory is returned as a tree with all
folders, and files beyond the budget fold into the line `[N files: …]` at the
folder or `[N more files]` inside it, both with the way to read them). Every
result holds up to 100 000 characters, and every cut names the way to get the
rest. A URL without a selector, for example `agent://`, `omp://` or
`artifact://`, is also returned whole up to 100 000 characters: `read` pages
the native `read` by 3000 lines, and `agent://<id>` reads the subagent's answer
file and unwraps its JSON. Paths are forgiven: `~`, backslashes, and on Windows
`/c/Users` and `c:/`; a missing path names the nearest existing folder and
similar names. Images, archives and omp selectors like `:raw`, `:50-80`,
`:conflicts`, `:img` go to the native `read`. The `bash` result comes in a
Shell wrapper (`Exit code`, `Command output`, `Command completed in N ms.`).
Plan-mode child tasks do not get extensions and stay on the built-in `read`,
`grep`, `glob`. `spotty`, `smarty` and `bossy` get `read, glob, grep`,
`shell_runner` gets `bash, read, grep`, `codebase_explorer` gets
`bash, read, glob, grep`; `bash` for `codebase_explorer` is only for queries to
external sources. The `codebase_explorer` definition sets a greedy search: one
`grep` alternation of 10–30 terms, whole files in parallel batches, and a stop
once the answer is confirmed; the same order applies to wikis, trackers, PRs and
chats.

From the session start `harness.ts` turns on `grep`, `lsp` and `ast_grep` for
all agents; rare tools stay in `xd://` on request. To the `omp-tools` block in
every agent's system prompt it appends the environment line: the built-in
bash-compatible shell, the form of absolute paths (on Windows `C:/Users/...`,
without `/c/...` and backslashes) and the programs found on PATH.

`write.ts` replaces the built-in `write` with a wrapper over it: a call runs in
parallel with other calls, takes `path` and `content` or `files`, and writes the
files at the same time. A file that is already being written gets the "busy"
rejection at once, and the other files are written; the answer lists the
written, busy and failed files and is marked as an error if at least one file
is not written. `agent://`, `local://`, `xd://`, archives, SQLite and LSP go
through the built-in `write`.

`edit.ts` replaces the built-in `edit` with a wrapper over it and, for the
session and without writing to `config.yml`, switches edits to work without
`[PATH#TAG]` marks: GPT gets the native `apply_patch` with hunks unchanged, the
other models get text replacement. The format is chosen by the model of each
agent separately, Main and every subagent, at the start of each of its turns,
so a model change during work takes effect. A replacement runs in parallel with other
calls and takes `path`, `old_string`, `new_string` or `edits`, several
replacements in one or several files. Different files are edited at the same
time, the edits of one file in order, and after a failed edit the other edits
of that file are skipped. A file that another `edit` or `write` is already
changing gets the "busy" rejection at once, and the other files are edited. A
failed edit shows the nearest match with line numbers.

For GPT, the wrapper splits `apply_patch` by file and applies files
independently through omp's patcher. If a plain update with several hunks
fails, it retries those hunks in order; applicable ones stay applied and
rejected ones return with their file, hunk number and native error. Add,
delete and move sections remain whole operations. Batch replacement and patch
results carry the actual diff and per-file results for the `+N −M` feed counts.

`bash.ts` replaces the built-in `bash` with a wrapper over it. A command
without `timeout` has no deadline and is never killed, neither at once nor in
the background; `timeout` in seconds sets the deadline. `block_until_ms` sets
how long to wait for the command before it moves to the background: 0 starts it
in the background at once, like `async: true`, and without the parameter the
wait is 60 000 ms. The wait goes through the shared setting
`bash.autoBackground.thresholdMs`: the wrapper sets the call's value before it
starts and separates changes of the value between calls with a 50 ms pause.

`ask.ts` replaces the built-in `ask` with a wrapper: `title` names the form and
shows as the label of the first question or, when it already has a label, as
the start of its text; options have an optional `id`, and the answer adds the
line `Selected option ids:` with the ids of the chosen options. Subagents do not
get `ask`.

The `grep`, `glob`, `read`, `bash` and `edit` wrappers treat as absent the empty
fields that GPT models send: an empty string, `0` in numeric fields and `ready`
without `log` and `port`. `read` of a URL that does not accept a line range
repeats the request without the range; `xd://` reads ignore `offset` and `limit`,
strip trailing numeric line selectors, and invoke the native reader. For GPT
models, `harness.ts` appends short tool
notes about known paths and setting names, listed PATH programs, internal URLs,
current computer windows and retrying only rejected hunks.
For write batches, empty single-file defaults do not count as a second target;
empty content with a real path remains a valid empty-file write.

A subagent's step is visible in its row at the parent: `tools.intentTracing
true` in step 4 of [omp.md](omp.md) adds a short intent to every tool call, and
the subagent's row shows the latest one.

`todo.ts` replaces the built-in `todo` with its own tool of the same name and
the same omp task panel; the list does not depend on the goal. A call runs in
parallel with other calls and takes a chain of operations `ops` (`init`,
`append`, `start`, `done`, `drop`, `block`, `unblock`, `rm`, `plan`, `step`,
`closed`) applied in order. On the first error the completed operations are
kept, and the answer names the failed operation, its fix, the operations not
applied and the current list. An item is found by its number `phase.item`, for
example `2.3`, or by its text even when dashes, arrows, quotes, spaces and case
differ. An item has a title and a plan of steps in order; `step` marks the
current step, and the step bar stands directly beneath the item's row on the panel. The
answer is one or two lines: what changed and what to do next. While the list
has open items, Main sees the open items with their numbers and the plan of the
current item in every model request, and omp's list block is removed from the
goal context. Closed items fold into counts: a phase without open items takes
one line, and the other phases show only their open items with their numbers.
The `closed` operation with an optional phase shows the closed items and does
not change the list. A closed list leaves the context and panel, but stays in
session history. With no open items, Main receives an ephemeral reminder to
create the next multi-step task's list before acting, extend unfinished work
with `append`, and replace a closed list with `init`. Empty fields that GPT
models send are ignored. While the list has `pending` or `in_progress` items,
Main cannot finish its turn (`session_stop`): it closes them, drops them or
marks them as waiting.

`results.ts` gives the agent full results: the preview of a subagent's answer
(`<preview full-output="agent://…">` and `Full output: artifact://…`) is
replaced with the full answer up to 80 000 characters, and the cut output of
`bash` and `eval` with the full output from the artifact up to 100 000
characters. All results of one turn share a budget: 150 000 tokens (at 4
characters per token) while the context is below 50 000 tokens, otherwise half
of the room left before the compaction threshold. A result beyond the budget is
cut, the full text is saved to a file next to the session, and the cut line
names the file and the `offset` to continue.

The Gold Standard works as a working contract:

- The agent takes the shortest direct path: it gathers the minimum of needed
  information, digs deeper only at a contested point and only until it is
  settled, and chooses a solution by expertise, documentation and logic,
  without experiments and measurements.
- Heavy work (deep research, comparing options, experiments, measurements, new
  tests, checks beyond those covering the change, extra reviews and subagents)
  runs only on the user's direct order or under an adopted procedure.
- Existing checks run once after a code change.
- Reviews run automatically by the work class from `main-workflow`: micro
  (point corrections here and there with an obvious meaning) without a check,
  small (up to 5 requirements and up to 5 changed files) is checked by Spotty
  before handover, large by Smarty; in `/define-goal` the class is written in the
  goal. Two more automatic Spotty checks run in plan mode. Bossy runs only on
  explicit choice. Every check runs until CLEAN. A mandatory gate from the
  repository's instructions, for example the finalization gate, runs in
  parallel with the class check.

`omp-tools` puts the speed of the result first and the number of turns second:
independent calls go in one response or in a JS `eval` cell with `Promise.all`,
output limits are counted for the whole batch, temporary files are created only
in the OS temporary folder, which the system cleans. Root Main hands searches over
unfamiliar files, several rounds of searching, external sources and material
larger than its context to `codebase_explorer` by the hidden skill
`subagents`, and writes briefs for `codebase_explorer`, `code_writer` and
`shell_runner` by the visible skill `subagent-brief`.

`main-workflow` applies only to root Main:

- Root Main automatically keeps a `todo` list for every task except one answer
  or one short action, and always for work with a review. It creates or extends
  the list before the first action; continued unfinished work uses `append`,
  and a new task after a closed list uses `init`. When it starts an item, it
  writes the item's plan as steps and marks the steps as it goes. All
  list changes of one moment go in one call. The list holds stages with draft
  decisions; findings lie in `local://<subject>.md` files named in the list
  items.
- For a task of several dependent stages, root Main sets a goal (`goal`) itself
  and completes it only after the result and the mandatory actions.
- Before work with changes, except micro, root Main splits the request into
  checkable requirements of one sentence each, writes them with the work class
  into the chat and confirms them with one `ask` with a one-sentence question,
  because the `ask` panel shows only four lines of a question; the agreement is
  the user's words and the accepted requirements.
- `/define-goal [rough objective]` in root Main starts the procedure
  `extensions/define-goal.md`: `harness.ts` registers the command, sends the
  message `Define goal: …` and supplies the procedure in a hidden message. The
  agent reads the affected files, asks through `ask` only what they do not
  settle, and writes for itself a goal with the sections Objective, Quotes
  (verbatim user quotes), Success criteria (a check for every criterion),
  Boundaries, Stop conditions and Review (the work class). Before each interview
  question, the agent gives its option, its reason and the alternatives in the
  chat. It checks the goal against the user's words and puts a short retelling
  into the chat: a bold sentence with the main point, numbered items with exact
  values, then «Границы», «Остановка» and «Проверка». It gives its own proposals
  in the retelling with a reason and alternatives. In one `ask`, each choice is a
  separate question with options, and the last question accepts the whole goal;
  the goal itself does not go into the chat, and the accepted retelling replaces
  the requirement step. Questions and messages are clear without earlier
  messages: the agent does not refer to codes and item numbers without
  restating them. Before completing the goal, the agent itself runs the criteria
  checks and the reviewer of the class (small — Spotty, large — Smarty) until
  CLEAN, and gives the result briefly: what is done and whether the checks
  passed. In plan mode and with an active or paused goal, the command only shows
  a notice.
- In omp plan mode, Light Review (Spotty) checks the plan before it is proposed
  for approval and the result of carrying out the approved plan.

Clear Communication: Main starts a chat message with a bold sentence carrying
the main point and puts the question at the end. Usually it is one paragraph of
1–4 short sentences, at most 12, and a reply of several parts is 2–3 paragraphs
of 1–3 sentences separated by a `---` line with empty lines around it. Main
writes reasons, the course of work, checks and options only on request, and at
an approval it shows its proposal, its reason and the real alternatives. Every
message and every question is clear without earlier messages. The same skill
holds the rules for progress messages and a self-contained final answer. Blocks
with bold labels are the detailed form, only on a direct request. The harness
has no HTML reports.

Main launches only the harness agents from `agents/*.md`; omp's built-in agents
are turned off by `task.disabledAgents` in [omp.md](omp.md). The hidden skill
`subagents` lists them for Main: name, when to use it and its model, plus the
reuse and brief rules. `harness.ts` gives it only to root Main.

`subagent-model-policy.ts` sets the models and wraps the `task` tool:

- Each named agent is started by name in `agent` and runs on one model from the
  `NAMED` table under any parent: `spotty` on `anthropic/claude-haiku-5-5:low`,
  `smarty` on `anthropic/claude-haiku-5-5:medium`, `bossy` on
  `anthropic/claude-sonnet-5-5:low`, the others on
  `anthropic/claude-haiku-5-5:high`. Without an `anthropic` sign-in these agents
  do not start.
- The agent `custom` has no role. Main launches it only when the user directly
  tells it to run a subagent on a named model: one `task` item with
  `agent: "custom"`, `model` (`provider/model` from the available models) and
  an optional `effort` (off, minimal, low, medium, high, xhigh, max). The
  wrapper checks the model, strips both fields, delegates to omp's own `task`
  and sets that model through `before_subagent_spawn`; such calls run one at a
  time until their subagent starts. Without `model`, `custom` runs on Main's
  current model.
- The extension blocks no launch. In subagents it turns off
  `retry.modelFallback`.

A new agent is a file `agents/<name>.md`, a line in `NAMED`, a line in the
`subagents` skill and a row in the table below; a model change touches `NAMED`,
the skill and the table. `node tests/run.mjs` catches a mismatch between them.

On omp start, `default-model.ts` sets the root session's model to `anthropic/claude-opus-5-5` and reasoning medium if the session is new and the command line has no model selection flags (`--model`, `--models`, `--thinking`, `--provider`) and no session continuation flags (`-c`, `--continue`, `-r`, `--resume`, `--session`). It fires once at omp start (the `session_start` event does not repeat on `/new` and `/resume`), does not touch subagents and sessions with history, and does not change `config.yml`; `modelRoles.default` stays a machine setting.

`subagent-reuse.ts` lets Main reuse an unoccupied subagent with a context reset: when an IRC message from Main (`write agent://<id>`) starts with the marker `[task <id>#<n>]`, the extension, in the subagent's session, cuts everything before the last such message before each model request, so the model sees only the system prompt and the new task. The session file keeps all tasks whole; an earlier task is found by its marker in `history://<id>`. The public `context`, `message_end` and `agent_end` events keep the current numbered task's statistics for the hub; a new marker resets its displayed tokens, tools, requests and time. Main's reuse rule is in the `subagents` skill.

`cursor-feed.ts` redraws the omp feed in a compact Cursor style with plain
English labels; the model sees the tools unchanged, only the drawing in the
terminal changes. Each state-bearing item or result in the feed, todo panel, `task`
card, the agent panel and the agent board starts with the same circle `●` in
one column and one space after it; its color is the state (yellow — running or
waiting, green — done, red — error or stopped, grey — not started), and a nested
line moves right by exactly two columns. Headers and summary lines carry no
icon and no circle: "To-dos", "N agents working", the board title "Agents", the
agent card, "Task from Main", the goal card and "Worked for
7m 11s ›"; an icon stands only where it says something that the text does not. A line that is cut at its end ends with "…" in
the color of the text it cuts. Every call of a built-in tool is one
line: the circle, a verb, the essence of the call (path, pattern, command) and
the time. A path is
shown relative to the working folder, or with `~` for the home folder; when the
line is too long, the path loses its start (`…/cursor-feed/rows.ts`), so the
file name and the `+N −M` counts always stay visible. Consecutive reads,
searches, other tools including MCP, and bash commands merge into
"Explored N files, M searches, K tools, ran C commands"; zero counts are
omitted and the live group says "Exploring". Goal get/resume count as tools;
text, todo, ask, goal create/complete/drop, subagent cards and errors split
the group. Edits and writes keep one row per file: "Edited path +N −M" or
"Wrote path +N". Expanded groups retain every call and its available output.
Reasoning text stays hidden in both modes, during streaming and replay.
The current-action row says "Planning next moves" while the model thinks,
then a tool phrase such as "Reading client.py", "Searching files", "Running
command" or "Waiting for subagent" while a tool runs. A light sheen crosses
the whole phrase, without an icon or timer; the row disappears when no action
is active. No reasoning-duration rows remain in the transcript. Collapsed
calls have no raw argument fields, output body or Expand hint. Standalone
LCM tools say `Searched memory "query" · N found`, "Viewed memory map" or
"Opened memory summary". A finished Main turn
is folded: everything between the question and the final answer becomes the
line "Worked for 7m 11s ›"; text that the agent wrote right before an `ask` stays
outside the fold. Ctrl+O expands and folds everything at once: edits show the
diff, Explored one action per line, commands and memory tools their full
output, Worked for the turn. So that lines that have scrolled up also
change, at the end of a turn and after Ctrl+O omp redraws the screen once and
erases the terminal history, including the text that was in the window before
omp started. A `task` call is a card: the header "Running 2 agents · 1 done" or
"3 agents finished · 1 failed · 4m 10s", then two rows per subagent: its status
circle, name and agent type, followed by its indented live action with a
light sheen. That second row has no circle and ends as "Completed", "Stopped"
or "Failed". Main's live-subagent rows in the feed carry the grey hint
"alt+a agents" beside each agent ID. Their panel shows "N agents working", up to
four agents and the current action of each, without clicks.

Every way of opening omp's Agent Hub (a double ← in an empty field, alt+a,
ctrl+s, `/hub`, the agents pill) opens the harness agent board instead, a
fullscreen view split into two equal halves. The top line shows "Agents", the
counts of working, idle, done and failed agents and "esc close". Hub lifecycle
colours are green for working, yellow for idle, grey for done or parked, and red
for failed or stopped; circles, labels and counts agree. The left half lists the
subagents, working ones first, in two lines each: status circle, name with its
current numbered task `#n` and time,
then the description. The right half is the card of the selected agent: its type
and model, then Task, Now (while it works), Result (when done) or Error (when it
failed), Time with the start time, and Usage in tokens, tools and requests,
counted only since the current task's `[task id#n]` marker. Keys:
↑/↓ or j/k select, Enter opens the agent's feed in the main window in the same
style, where its assignment is shown as a "Task from Main" card, x stops a
working agent, and Esc or q close the board; left has no action. Below 60
columns only the list is shown; in a collab guest session the stock Agent Hub
opens. In a subagent's feed the input says
"Subagent view · esc main · ←← agents" and accepts no typing or Enter.
Model and reasoning-level changes are blocked. Esc returns to Main; double-left
opens the hub. Every subagent view has the red hint
"alt+x alt+x stops this agent"; pressing alt+x twice within 500 ms stops only
that agent. Its title and status rows show its own state in colours reduced
by 10%. The title shows its full session ID and current task `#n`.
The main draft returns when leaving the view; wheel scrolling remains
available. This look
comes from the owner's settings from [omp.md](omp.md):
`display.hideToolActivity: false` (with `true` omp hides calls entirely) and
`hideThinkingBlock: true`.

One widget directly above the input draws, top to bottom, the current action
if present, one blank row after it, the todo panel and the session title/ID
row; omp's divider and input follow. The action and blank row disappear
together when no action is active. The collapsed panel shows
"To-dos: 12 total · 3 left" and up to three tasks across all stages: the previous,
current and next task. Near the end it shifts back to keep three tasks visible;
fewer tasks use fewer rows. Done keeps a green circle and dim text, the current
task a yellow circle, and waiting a grey circle. The current task's plan bar
sits directly beneath it, indented two more columns: eight Nerd Font progress
cells followed by "2/4 step text". This nested row is additional to the header
and task rows. Ctrl+O shows every stage and task and all steps of the current
task, with done and current step marks. The panel hides when every task is completed or abandoned; blocked
tasks keep it visible. There is no separate native todo panel or progress widget. A `todo` call in the feed is the line
"● To-do 4/7 ● closed ● started", where the closed task's circle is
green and the started task's circle is yellow. Interactive actions stay in
the feed and split the "Worked for" fold into parts. While an `ask` waits, its
row is one line "Waiting for your answer · N questions", because the questions
themselves stand in the `ask` panel below; after the answer the card shows each
question in full with the answer under it (the chosen option as is, the
owner's own text in «», otherwise "— no answer"), and Ctrl+O adds all options.
`goal` is "Goal set" with the complete wrapped Objective section in both modes,
"Goal complete", "Goal checked", "Goal resumed" or
"Goal dropped" after the status circle; `/goal <objective>` and `/define-goal`
messages are the cards "Goal" and "Define goal", with the complete initial
goal text in the normal text colour, visible in both modes and selectable
for copying. Goal and assignment instruction bodies use the same readable
text colour; pausing, resuming and dropping
the goal are the lines "Goal paused" (yellow circle), "Goal resumed" (green)
and "Goal dropped" (red) instead of the omp statuses. The `/goal` menu, "Drop goal?", the goal input and the choice
after a plan leave the line "title → choice" with a green circle or
"title — no answer" with a grey one. The lines of dialogs and goal events survive omp's feed rebuild (a
cancelled send, a settings change, compaction) and live until the session
restarts.

The queued-message band refreshes when the queue changes, including the first
owner message. It uses omp's existing band and input behavior.

`status-bar.ts` builds the omp status line under the input field up to three
rows and a row above the line over the field: on the left the bold session
name with the same natural gold gradient as the full compaction bar
and "Worked …" for the last turn, on the right the full session ID without
an icon, followed by two spaces before the edge. A long title is cut before
the ID. The first row under the field, right
next to it, is the compaction bar: a full-width white-grey bar with a grey label
`N% <tokens>/<trigger>` that measures the context up to the compaction trigger
(`compaction.thresholdTokens`, else `compaction.thresholdPercent`, else the
window minus the reserve) and shows 100% at or above it; the bar fills by the
same share. At the trigger the bar
turns natural gold, a gradient from dark gold `#8a6d1c` through `#c9a227` to
light gold `#e3c45a`, and while compaction runs (`auto_compaction_start` or
`session_before_compact` until `auto_compaction_end` or `session_compact`) a
warm glint moves along it. The second is omp's native row: the model, the generation
speed `token_rate` (the extension takes the live speed of the omp session, the
same counter as the built-in `composer.tokenRate`, which is turned off, updates
it every 80 ms during a turn, keeps the last value between turns, puts the
theme's speed icon right in front of the number and colors it: below 30 tok/s
red, below 60 yellow, below 90 pale green, otherwise bright green), the modes
(plan and goal together), the memory counters `86  / 12 ` on a faint panel
background and the counters of working
subagents (the one-cell Nerd Font users glyph U+F0C0) and background jobs.
The model row has no turn timer; the completed turn keeps "Worked …" above
the input. In a subagent view the rows use its model, speed and context.
The third is omp's right segments: folder, git branch and PR; the
extension moves them here from the line above the input field, and that line
stays a plain grey line whose brightness follows the reasoning level.
The layout and segments are set by [omp.md](omp.md). `autocompaction.ts` sets
Main's autocompaction threshold: 270 000 tokens for all Claude models and
258 400 (95% of 272 000) for all GPT models, if the threshold is below the
context window.

`lcm/index.ts` is the only context compaction: a copy of pi-lcm 0.1.3 with our
changes (MIT license in `extensions/lcm/LICENSE`). Storage, search, the summary
graph and the assembly of the window text run in a Node-API native module from
the Rust crate `crates/lcm-native`, loaded into the omp process:
`extensions/lcm/native/lcm_native.darwin-arm64.node` on macOS Apple Silicon and
`lcm_native.win32-x64.node` on Windows x64. Hooks and model requests stay in
TypeScript. The module keeps the history in its own new SQLite schema with
integer keys, a partial index of uncompacted messages, a flag of condensed
summaries, separate links of summaries to messages and to summaries, and FTS5
full-text search over messages and summaries. When the uncompacted messages
exceed 30 000 tokens, LCM writes summaries of chunks in the background on
`anthropic/claude-haiku-5-5` with reasoning low: up to 15 in parallel, without
prompt caching, no more than 100 000 tokens of input and output per call. At the
autocompaction threshold omp calls the `session_before_compact` hook: LCM
finishes the summaries for up to 25 s and gives omp the text of the new window
of up to 12 000 tokens from the summaries not yet condensed, newest first, even
when there are few messages; the summaries left out stay reachable through
`lcm_grep` and `lcm_expand`. With the last 8000 tokens of messages
(`compaction.keepRecentTokens 8000` in step 4 of [omp.md](omp.md)), the system
prompt and the tools, the window after compaction takes about 50 000 tokens.
Only Haiku 5.5 writes summaries, without the session's fallback model; every
request is retried up to two times. If a summary still fails after the retries,
the hook hands compaction to omp, and the regular chain (`soft`) works. The
prompts require carrying facts over as they are, inventing nothing and
dropping nothing. The tools `lcm_grep`, `lcm_describe` and `lcm_expand` load on
request through `xd://` and search and expand the original messages; the
commands `/lcm` and `/lcm-settings` show the state and the settings. In the status line LCM shows the muted counters `86  / 12 ` on a faint panel background, and while it writes summaries the same place shows
"saving memory · N parts…" or "merging memory…"; a failure is one short notice
that says what will happen next. The databases `<cwd hash>.db`, the cost log
`costs.jsonl` and the shared `/lcm-settings` settings (`settings.json`) lie in
`~/.omp/lcm`; the `LCM_DB_DIR` variable replaces the folder for the databases
and the log. Earlier databases lay in the `lcm` folder next to the omp
executable (`process.execPath`): the first time a project opens, LCM finds the
database of this cwd there and moves it into the new schema without losses,
comparing the numbers of conversations, messages and summaries; the old
database is not changed. The other kinds of compaction are turned off by the
step 4 keys of [omp.md](omp.md): `compaction.methodOrder` `["soft"]` keeps only
the regular summary, which the LCM hook replaces; `compaction.asyncEnabled
false` turns off omp's background early summary;
`compaction.experimentalContextManagement false` removes the
notepad, `context_notes` and `new_context`; `compaction.supersedeReads false`
and `compaction.dropUseless false` turn off trimming of tool outputs.

`model-arrows.js`: shift+↑ and shift+↓ switch Main's model through the list
Claude Opus 5.5, Claude Sonnet 5.5, Claude Haiku 5.5, Claude Fable 5.1, GPT-6.1
Sol, GPT-6 Luna, GPT-5.6 Luna.
`harness.ts`: ctrl+shift+P pauses the active goal, and a second press resumes it
(the extension puts `/goal pause` or `/goal resume` into the empty input field);
the key arrives separately from ctrl+P only in a terminal with the kitty
protocol or CSI u. ctrl+P itself does not switch the model: `keybindings.yml`
from [omp.md](omp.md) turns it off. A paused goal (after Esc or ctrl+shift+P) is
resumed by the next message: for a regular message (not `/` and not `!`)
`harness.ts` first runs `/goal resume` and passes the message with its images to
the agent after the goal resumes, and replaces `.` or `c` with Enter with
`/goal resume`. When omp pauses the goal itself, for example when Esc or a
steering message interrupts a turn, `harness.ts` resumes it as soon as Main
works again (a turn starts, Main starts writing a message or calls a tool); a goal paused with a `/goal`
command, including ctrl+shift+P, stays paused while Main works and resumes only
by the owner's action: `/goal resume`, a second ctrl+shift+P or the owner's
next message, as described above. If a Main turn starts without an owner
message, for example with a subagent's result, while the goal is paused,
`harness.ts` tells Main in a hidden message to resume it with its first call,
the `goal` tool with op `resume`. shift+↑ works thanks to `keybindings.yml` from [omp.md](omp.md).
`reasoning-arrows.js`: shift+← and shift+→ lower and raise reasoning among the
levels the model supports; `off` is added as the no-reasoning level: for Sonnet 5.5 it is
`between_tools` with effort medium, for Haiku 5.5 thinking is turned off
(`thinking: disabled`) with effort high; the request hook sets them on send.

Named agents:

| Agent | Model | Role |
|---|---|---|
| `spotty` | `anthropic/claude-haiku-5-5:low` | Light review |
| `smarty` | `anthropic/claude-haiku-5-5:medium` | Blind review |
| `bossy` | `anthropic/claude-sonnet-5-5:low` | High review |
| `codebase_explorer` | `anthropic/claude-haiku-5-5:high` | greedy read-only search over the code and external sources |
| `code_writer` | `anthropic/claude-haiku-5-5:high` | code and configs from Main's briefs |
| `shell_runner` | `anthropic/claude-haiku-5-5:high` | program runs from Main's briefs |
| `custom` | the model the user names | no role; only on the user's direct order |

Skills. Eight hidden ones (`hide: true`) are called through `/skill:<name>` and
`skill://<name>`; Main reads the visible `subagent-brief` before a brief for
`codebase_explorer`, `code_writer` or `shell_runner`.

| Skill | Purpose | Visibility |
|---|---|---|
| `gold-standard` | the complete result by the shortest direct path, heavy work only on a direct order | hidden |
| `main-workflow` | root Main's plan mode, `todo` and goal | hidden |
| `clear-communication` | short chat messages, progress messages and the final answer | hidden |
| `subagents` | root Main's subagent types with their models, reuse of idle subagents and briefs | hidden |
| `omp-tools` | omp tool mechanics: the speed of the result first, then the number of turns, output limits, safe writes, temporary files in the OS temporary folder | hidden |
| `subagent-brief` | briefs for `codebase_explorer`, `code_writer` and `shell_runner` and acceptance of their finals | visible |
| `blind-review-cycle` | blind Smarty passes until CLEAN; the shared contract of the three cycles: Main and the reviewer work as one team on the user's agreement, findings and rejections rest on verbatim quotes, Main must fix a finding with quotes, rejections are passed to the next passes | hidden |
| `light-review-cycle` | blind Spotty passes until CLEAN | hidden |
| `high-review-cycle` | blind Bossy passes until CLEAN | hidden |

Every cycle ends with one clean pass. The agents' models are in the table above.

| Skill | Agent | When it runs |
|---|---|---|
| `blind-review-cycle` | `smarty` | on explicit invocation and in the check of large work (including a `/define-goal` goal) |
| `light-review-cycle` | `spotty` | on explicit invocation, in the check of small work (including a `/define-goal` goal), in omp plan mode (the plan before it is proposed and the result of carrying out the approved plan) and in the repository's finalization gate |
| `high-review-cycle` | `bossy` | on explicit invocation |

## Requirements

- [omp](omp.md) and git. Windows needs Git for Windows. Run commands through the
  omp bash tool or Git Bash.
- Provider credentials:
  - `openai-codex` for GPT;
  - `anthropic` for Claude and for all named agents under any parent.
- Global `config.yml` values; the other keys are kept:
  - `extensions` contains the clone path.
  - `task.maxConcurrency` equals `0` (no limit). Above a non-zero limit omp
    queues launches, and `proc://` shows them as `running`.
  - `tools.artifactSpillThreshold` is not below 100 (omp sets 50 by default),
    otherwise omp cuts out the middle of reads in chunks of ~90 KB;
    `read.defaultLimit` is assumed to equal 3000.
  - On Windows, `shellPath` is the path to `bash.exe` from Git for Windows:
    services, terminals and `!` go through it. Regular bash tool calls already
    work in omp's built-in POSIX shell.

## First installation

The commands are the same on macOS and Windows (bash).

1. If there is no clone, clone the repository and remember the clone path:

   ```bash
   git clone https://github.com/ARQAWA/my-omp-harness.git ~/my-omp-harness
   CLONE="$(git -C ~/my-omp-harness rev-parse --show-toplevel)"
   ```

   On macOS it is `/Users/...`, on Windows `C:/Users/...`.
2. Run `omp config get extensions --json`. If the array has no `CLONE` (or an
   entry with `~` for the same path), run
   `omp config set extensions '<JSON array of the previous elements and the $CLONE value>'`.
3. Run `omp config get task.maxConcurrency`. If the value is not `0`, run
   `omp config set task.maxConcurrency 0`.
   Run `omp config get tools.artifactSpillThreshold`. If the value is below 100,
   run `omp config set tools.artifactSpillThreshold 100`.
4. Windows only: run `omp config get shellPath`. If the value is empty, set the
   path to `bash.exe`: by default `C:/Program Files/Git/bin/bash.exe`, and for a
   single-user Git installation `%LOCALAPPDATA%/Programs/Git/bin/bash.exe` (the
   variable expands to an absolute path).
5. If the system prompt is part of the order, install it by
   [its instruction](system-prompt.md).
6. Install the package dependencies from `bun.lock`:
   `BUN_BE_BUN=1 omp install --cwd "$CLONE" --frozen-lockfile`. The
   `BUN_BE_BUN=1` variable runs the Bun built into omp; a separate Bun is not
   needed.
7. Download the LCM native module for your OS from the `lcm` release:
   `P=darwin-arm64` on macOS Apple Silicon, `P=win32-x64` on Windows x64, then
   `mkdir -p "$CLONE/extensions/lcm/native" && curl -fsSL -o "$CLONE/extensions/lcm/native/lcm_native.$P.node" "https://github.com/ARQAWA/my-omp-harness/releases/download/lcm/lcm_native.$P.node" && ls -l "$CLONE/extensions/lcm/native/lcm_native.$P.node"`.
   The module supports no other platforms.
8. Extensions load in a new omp process. Ask the owner to restart omp without
   interrupting the current task.

## Post-installation check

The installing agent runs the check on the target OS; `omp read` and `omp -p`
start new processes.

1. Read the values from "Requirements" again with `omp config get`.
2. Run `omp read skill://blind-review-cycle`. The first line must name
   `<CLONE>/skills/blind-review-cycle/SKILL.md`, and the content must contain
   `# Blind Review Cycle`.
3. Run a model call and a read of the child's session file in one command:

   ```bash
   omp -p --model anthropic/claude-sonnet-5-5 --thinking low "Answer in three lines. Lines 1-2, yes or no: does your system prompt contain the exact text (1) 'Apply the full Gold Standard to all work', (2) 'Apply the following communication skill before every user-facing message'? Line 3: call the task tool once, with no model field anywhere, context 'Install check.', and one task {name: InstallCheck, agent: codebase_explorer, solutionSpace: 'fixed reply', task: 'Reply with OK.'}; wait for it and print its output." && f="$(ls -t "$(omp config path)"/sessions/*/*/InstallCheck.jsonl | head -1)" && grep -m1 '"type":"model_change"' "$f" && grep -m1 '"type":"thinking_level_change"' "$f"
   ```

   Expected output: `yes` twice, the child's output, then from its
   session file the `model_change` line with `"model":"anthropic/claude-haiku-5-5"`
   and the `thinking_level_change` line with `"thinkingLevel":"high"`.
4. Check subagent reuse with a context reset in one command:

   ```bash
   omp -p --model anthropic/claude-sonnet-5-5 --thinking low "Call the task tool once, with no model field anywhere, context 'Install check.', and one task {name: ReuseCheck, agent: codebase_explorer, solutionSpace: 'fixed reply', task: a text of two lines, whose very first characters are the marker [task ReuseCheck#1] (no label before it), and whose second line is: The code word is ALPHA. Reply with OK.}; wait for it. Then call write with path agent://ReuseCheck and content of two lines, whose very first characters are the marker [task ReuseCheck#2], and whose second line is: What code word were you given earlier? Reply with the word, or NONE if you do not know. Wait for the reply and print it." && f="$(ls -t "$(omp config path)"/sessions/*/*/ReuseCheck.jsonl | head -1)" && grep -q ALPHA "$f" && grep -q '"message":"\[task ReuseCheck#2\]' "$f" && test ! -e "$(dirname "$f")/ReuseCheck-2.jsonl" && echo REUSE_OK
   ```

   Expected output: the answer `NONE` and the line `REUSE_OK`: the second turn
   does not see the first task, the session file `ReuseCheck.jsonl` keeps both
   tasks, and there is no new subagent. On any other result, report the failure
   to the owner and do not call reuse working.
5. Other model requests and trial tasks are not part of the check.

## Update

1. Run `git -C "$CLONE" pull --ff-only`. If there are local changes or the
   branches have diverged, stop and report; overwrite nothing.
2. Recheck the values from "Requirements": keep higher limits and the other
   settings.
3. If the system prompt is part of the order, update it by
   [its instruction](system-prompt.md).
4. Run `BUN_BE_BUN=1 omp install --cwd "$CLONE" --frozen-lockfile`: the command
   installs the package dependencies from `bun.lock` and changes nothing if they
   are already in place.
5. If `pull` changed `crates/lcm-native/` or the LCM module file is missing,
   download the module again with the command of step 7 of the first
   installation.
6. Ask the owner to restart omp: open sessions keep the previous context.
7. Run the checks of the changed parts. If `extensions/` or `agents/` changed,
   include check 3; run check 4 on every package update. Do not repeat the full
   first-installation check without a request.
