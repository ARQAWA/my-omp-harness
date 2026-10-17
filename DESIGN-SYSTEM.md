# Design system

The visual rules of the harness interface: omp with the `titanium-arq` theme and the harness extensions, and our herdr build. Every new or changed interface element follows them. The owner's decisions and their reasons are in the 2026-10-11 section of [HARNESS-DESIGN.md](HARNESS-DESIGN.md).

The reference is the stock Cursor IDE (3.24.12, theme Cursor Dark, agents window) without its blue accent: black, white-grey and grey gradients, compact, minimal, every element says what happens.

## Palette

| Token | Hex | Use |
|---|---|---|
| ink | `#141414` | deepest background, status line |
| coal | `#181818` | tool rows |
| panel | `#1c1b1a` | panels, herdr tab bar and overlays |
| card | `#232120` | cards, user messages, active rows |
| cardHi | `#2a2826` | selected row, focused herdr tab |
| line | `#2c2b2a` | borders, separators |
| lineSoft | `#222120` | muted borders |
| graphite | `#3a3836` | hover surfaces, quote borders |
| steel | `#5f5e5c` | dim text, unfocused borders |
| smoke | `#8d8d8c` | muted text |
| silver | `#b6b6b5` | labels, keys |
| chalk | `#d6d6dd` | focus, links |
| snow | `#f0f0f0` | main text, headings |
| ember | `#1a0f10` | background of a failed tool row, the darkest red tint |
| ash | `#4a4846` | the line over the omp input field at the lowest reasoning level |

There is no accent colour. Focus is white-grey (chalk), selection is a slightly lighter surface (cardHi), and nothing is blue, purple or teal. By the owner's order, the session name and the full compaction bar use natural gold.

## Indicators

Green, yellow and red mean state and nothing else.

| Colour | Hex | Meaning |
|---|---|---|
| green | `#00ff88` | done, success, added lines, git clean |
| yellow | `#ffb347` | running, warning, git dirty |
| red | `#ff4757` | error, stopped, needs the owner, removed lines |
| grey | `#5f5e5c` | not started, idle, unknown |

The tok/s number in the omp status line keeps its own scale: red below 30, yellow below 60, pale green below 90, green from 90.

The agent hub uses its own lifecycle colours: green for working, yellow for idle, grey for done or parked, and red for failed or stopped. Its circles, status labels and header counts use the same colours.

## Status circle

Each state-bearing item or result starts with one circle `●` in one column, followed by one space, coloured by its indicator table. The same glyph and size everywhere: omp feed rows, the to-do panel, the `task` card, the agent panel, the agent board, omp background job rows, herdr sidebar, agent panel, navigator, toasts, mobile view and machine states. A subagent's indented action line continues its title and has no second circle; the live current-action phrase has no icon while the model thinks and the yellow status circle while a tool runs or the agent waits. Nested rows shift by exactly two columns. The current to-do item keeps its yellow circle; its eight-cell progress bar of Nerd Font glyphs U+EE00–U+EE05 sits on the next row, indented two more columns.

## Icons and font

The font is IosevkaTerm Nerd Font Mono; its Mono build draws every icon in one cell, so rows do not shift. An icon appears only where it says something the text does not, such as the git branch or a pin. Headers and summary lines such as «Agents» and «Worked for 2m 10s» carry no icon.

## Text

All interface text is plain English at A2 level, without Russian; the todo phases, items and steps and the progress statuses that the agent writes are Russian. Each element says what happens, on what, and with what result, in one compact line where possible: `Edited …/cursor-feed/rows.ts +12 −3 · 0.4s`, `Ran eval`, `Waiting for subagent`.

Consecutive reads, searches, edits, writes, other tools including MCP, and bash commands merge into `Explored N files, edited E files, M searches, K tools, ran C commands`; zero counts are omitted and a running group says `Exploring`. A lone edit or write keeps its own `Edited path +N −M` or `Wrote path +N` row. Text, todo, subagent cards, goal create/complete/drop and errors split the group, and an error keeps its own red row; goal get/resume count as tools. Expanded mode shows each call with the last six lines of its output or diff. Collapsed calls show no raw argument fields, output body or Expand hint.

Reasoning text stays hidden in both modes, during streaming and replay. The live current-action row shows `Planning next moves` with a light sheen, driven by an internal 30 fps render ticker, only during an active turn. While a tool runs or the agent waits, the row is a yellow status circle and the action phrase without a sheen: `Reading client.py`, `Searching files`, `Running command`, `Waiting for subagent`. After Main's turn ends with a blocked to-do item and no active background work, the row shows `Waiting resolve blocker` with its red and gold sheen, the header says `Blocked` in red and herdr's session circle is red. Resuming work clears these blocked indicators; late streaming updates cannot restore `Planning next moves` for an ended turn. The row shows no elapsed-time counter and disappears when no action is active. omp's own `Working…` row with its `esc` hint and intent text, its idle tok/s row, a separate `Thinking` head and a reasoning-duration row never appear. Each subagent card has its name and agent type on one row, its live action beneath, and then `Completed`, `Stopped` or `Failed` when it ends.

While decisions are checked immediately before a request, the owner's message appears as a grey plate above the input. It uses the normal user message's Markdown layout and one background-filled blank row above and below the text, so changing to the normal message does not add padding or change text wrapping. Messages waiting in the steering queue do not start this check or show this processing plate.

Goal and assignment instruction bodies use the normal text colour. The initial Goal or Define goal card shows its complete wrapped source text in both modes, so it can be selected and copied.

The session name is bold with the natural gold gradient on the left of the header row; the session ID is muted on the right, without an icon and with two spaces before the right edge. A long title is cut before the ID. The name follows the current task: a new owner request or a committed to-do change refreshes it through omp's title generator, and the same name appears in the herdr sidebar. The bottom status line has two rows. Row 1, left to right: the model with its reasoning level, then the modes (goal, `Loop`, `Prewalk`), then the subagent count with the one-cell Nerd Font users glyph U+F0C0; at its right edge muted `cmp N`, a dot separator and `tok/s`. `cmp N` counts saved completed compactions of the viewed session, including zero, and restores from its journal when reopened. It remains visible without a separator when no speed is available. Row 2, left: the folder, then the collab and stream indicators, then the hidden background jobs count; at its right edge the git branch with its change count and the PR number. The status line has no turn timer; the completed turn keeps its «Worked …» label.

The collapsed to-do panel has no header and shows up to four items across all phases: the previous item, the current item and the next two. Near the end, earlier items fill the window. The current item's step bar is an additional row directly beneath it, followed by `2/4 step text`. Expanded mode shows every phase and item and all steps of the current item, with done and current step marks. The panel draws from the harness's own committed list, never from omp's todo HUD: it appears the moment the list is created, redraws after each committed operation, and disappears the moment every item is completed or abandoned; blocked items keep it visible and have a red circle.

The agent hub shows the current numbered task `#n` next to each agent ID. Tokens, tool calls, requests and time count only that task, starting again at a new `[task id#n]` message. The main agent's feed carries the dim hint `press ← twice: agents` alongside its running-subagent rows.

The subagent feed is a read-only view of its whole action log. Its input says `Subagent view · esc main · ←← agents`; typing, Enter, model changes and reasoning-level changes are blocked. Esc returns to Main, double-left opens the hub, and left has no action inside the hub. Every subagent view shows the red hint `alt+x alt+x stops this agent`; press alt+x twice within 500 ms to stop it. The title and status rows show the viewed subagent's state with colours reduced by 10%. The title includes its full session ID and current task `#n`.

The queued-message band appears when the first owner message waits, without needing a second message to reveal it.

The line under the omp input field is the compaction bar: it measures the context up to the compaction trigger, not up to the model's context window. Its label is `N% <tokens>/<trigger>`, N is tokens divided by the trigger, and at or above the trigger it shows 100%; the bar fills by the same share. Below the trigger the bar is white-grey with a grey label. When it reaches the trigger it turns natural metallic gold: a gradient from dark gold `#8a6d1c` through `#c9a227` to light gold `#e3c45a`. While compaction runs a warm sheen (`#f2de8a`, edges `#d9b84a`) moves along the gradient.

## Cutting long lines

- A cut line ends with «…» in the colour of the text it cuts (`extensions/cursor-feed/fit.ts`).
- A long path loses its start, never its end: the file name and the end of the path stay visible.
- Labels at the end of a row, such as `+N −M` and the time, stay visible at any width; the verb and path are cut first.

## Layout

Compact and flat: no boxes around rows; one blank line separates the live action from the to-do panel. The status line flows after the transcript and is not pinned to the bottom of the screen. Split views divide the screen into two equal halves, list on the left and card on the right.

One widget above the editor draws, top to bottom, the live action if present, one blank line after it, the to-do panel and the title/ID row; omp's divider and editor follow. Pasted-image previews sit inside the editor, below its top divider and above the input text and caret. When no action is active its row and spacer disappear. The to-do panel does not appear separately in the transcript, and its step bar has no separate widget. This fixed order also applies after restoring a session.

## How omp follows the rules

| Rule | Where |
|---|---|
| Palette, no accent, indicators | `settings/titanium-arq.json` (`accent` empty) |
| Status circle | `extensions/cursor-feed/` (`glyphs.ts` holds `●`), theme symbols `status.done` and `status.error` = `●` |
| To-do window and nested step bar | `extensions/cursor-feed/panel.ts`, `extensions/todo.ts` |
| Icons | `symbolPreset nerd` (`install-instructions/omp.md` step 4); font in step 5 |
| Text, one-line rows | `extensions/cursor-feed/rows.ts`, `tools.ts`, `cards.ts`, `subagents.ts`, `hub.ts` |
| Hidden reasoning, live current action | `extensions/cursor-feed/turn.ts`, `extensions/status-bar.ts` |
| Readable instruction bodies, full initial goal | `extensions/cursor-feed/cards.ts`, `subagents.ts` |
| Title left, session ID right, subagent glyph, compaction bar | `extensions/status-bar.ts` |
| Hub lifecycle colours and numbered-task statistics | `extensions/cursor-feed/hub.ts`, `agent-tasks.ts`, `extensions/subagent-reuse.ts` |
| Read-only subagent view and navigation | `extensions/cursor-feed.ts`, `extensions/status-bar.ts` |
| Queue refresh from the first message | `extensions/cursor-feed.ts` (`queue_update`) |
| Cutting | `extensions/cursor-feed/fit.ts`, `tools.ts` (`rowLine`) |
| Quiet settings | `install-instructions/omp.md` step 4: `tui.tight`, `recap.enabled false`, `statusLine.sessionAccent false`, `tui.codexResetFireworks false` |

## How herdr follows the rules

| Rule | Where in the fork `ARQAWA/herdr` |
|---|---|
| Palette, white-grey focus, no blue | built-in theme `titanium-arq` (`src/app/state.rs`, `src/config/theme.rs`), selected by `[theme] name = "titanium-arq"` in `config.toml` |
| Status circle | `status_icon` and `status_color` in `src/client/shell.rs`: `●` in both indicator modes, working yellow, blocked red, done green, idle and unknown grey; the same colours in toasts, the mobile view and machine states; the `●` badge of an available update next to menu and settings is red, because it needs the owner |
| Selection | focused tab and navigator row: cardHi background, snow bold text |
| Icons | Nerd Font pin U+F435 in the sidebar, branch U+E0A0 before the branch name |
