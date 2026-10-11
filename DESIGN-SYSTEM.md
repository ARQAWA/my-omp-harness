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

There is no accent colour. Focus is white-grey (chalk), selection is a slightly lighter surface (cardHi), and nothing is blue, purple, teal or gold. The one gold element is the compaction bar below, by the owner's order.

## Indicators

Green, yellow and red mean state and nothing else.

| Colour | Hex | Meaning |
|---|---|---|
| green | `#00ff88` | done, success, added lines, git clean |
| yellow | `#ffb347` | running, waiting for an answer, warning, git dirty |
| red | `#ff4757` | error, stopped, needs the owner, removed lines |
| grey | `#5f5e5c` | not started, idle, unknown |

The tok/s number in the omp status line keeps its own scale: red below 30, yellow below 60, pale green below 90, green from 90.

## Status circle

Every row that has a state starts with one circle `●` in one column, followed by one space, coloured by the indicator table. The same glyph and size everywhere: omp feed rows, the to-do panel, the `task` card, the agent panel, the agent board, omp background job rows, herdr sidebar, agent panel, navigator, toasts, mobile view and machine states. Nested rows shift by exactly two columns. The one exception is the current to-do row with substeps: an 8-cell progress bar of Nerd Font glyphs U+EE00–U+EE05 replaces its circle.

## Icons and font

The font is IosevkaTerm Nerd Font Mono; its Mono build draws every icon in one cell, so rows do not shift. An icon appears only where it says something the text does not, such as the git branch or a pin. Headers and summary lines carry no icon: «To-dos», «Agents», «Thought for 4s», «Worked for 2m 10s», the memory status, the turn time. Never add an icon for decoration.

## Text

All interface text is plain English at A2 level, without Russian. Each element says what happens, on what, and with what result, in one compact line where possible: `Edited …/cursor-feed/rows.ts +12 −3 · 0.4s`, `Searched memory "theme" · 4 found`, `Waiting for your answer · 2 questions`.

Collapsed bash and memory calls have one compact summary row, with no raw argument fields, output body or Expand hint. Their details appear only in expanded mode. Reasoning text is also shown only in expanded mode, including while it streams. The summary `Thought for …` appears only when the measured reasoning took at least four seconds; shorter or unknown durations have no summary row.

Goal and assignment instruction bodies use the normal text colour. The initial Goal or Define goal card shows its complete wrapped source text in both modes, so it can be selected and copied.

The session title is on the left of the header row and the session ID is on the right, without an icon. A long title is cut before the ID. The bottom status line marks the subagent count with the one-cell Nerd Font users glyph U+F0C0 instead of an emoji.

The queued-message band appears when the first owner message waits, without needing a second message to reveal it.

The line under the omp input field is the compaction bar: it measures the context up to the compaction trigger, not up to the model's context window. Its label is `N% <tokens>/<trigger>`, N is tokens divided by the trigger, and at or above the trigger it shows 100%; the bar fills by the same share. Below the trigger the bar is white-grey with a grey label. When it reaches the trigger it turns bright gold `#ffd700`, and while compaction runs a gold glow (`#fff3b0`, edges `#ffe66e`) moves along it.

## Cutting long lines

- A cut line ends with «…» in the colour of the text it cuts (`extensions/cursor-feed/fit.ts`).
- A long path loses its start, never its end: the file name and the end of the path stay visible.
- Labels at the end of a row, such as `+N −M` and the time, stay visible at any width; the verb and path are cut first.

## Layout

Compact and flat: no boxes around rows, no extra blank lines, the status line flows after the transcript and is not pinned to the bottom of the screen. Split views divide the screen into two equal halves, list on the left and card on the right.

## How omp follows the rules

| Rule | Where |
|---|---|
| Palette, no accent, indicators | `settings/titanium-arq.json` (`accent` empty) |
| Status circle | `extensions/cursor-feed/` (`glyphs.ts` holds `●`), theme symbols `status.done` and `status.error` = `●` |
| Progress bar | `extensions/cursor-feed/panel.ts` |
| Icons | `symbolPreset nerd` (`install-instructions/omp.md` step 4); font in step 5 |
| Text, one-line rows | `extensions/cursor-feed/rows.ts`, `tools.ts`, `cards.ts`, `subagents.ts`, `hub.ts`, `extensions/lcm/` |
| Reasoning only when expanded, duration from four seconds | `extensions/cursor-feed/turn.ts` |
| Readable instruction bodies, full initial goal | `extensions/cursor-feed/cards.ts`, `subagents.ts` |
| Title left, session ID right, subagent glyph, compaction bar | `extensions/status-bar.ts` |
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
