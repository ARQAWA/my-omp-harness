# my-omp-harness: a Cursor-style harness for the omp (oh-my-pi) AI coding agent

my-omp-harness turns [omp](https://github.com/can1357/oh-my-pi), the oh-my-pi
terminal AI coding agent, into a fast and disciplined coding setup with a
premium Cursor-style terminal interface. You get a compact feed with Nerd Font
icons, a two-pane board for subagents, full tool results without rereads,
parallel `write`, `edit` and `todo`, lossless context memory on a native Rust
module,
fixed-model subagents plus any model you name, and blind reviews that check every result
against your own words. It installs on top of stock omp as one package, without
a fork, so `omp update` keeps working.

## Why use it

- **It does what you asked and nothing more.** The system prompt and the Gold
  Standard keep the agent on the exact scope, the shortest direct path and the
  smallest result. Heavy work, such as deep research, experiments or new tests,
  runs only on your order.
- **Plans you can follow.** Before a multi-step task starts, Main creates or
  extends its todo list; a closed list is replaced for the next task and leaves
  the panel. The current item shows a bar of its plan steps, and a long task gets
  an omp goal. `/define-goal` interviews
  you, keeps your words as verbatim quotes and ends with a mandatory reviewer
  check. A paused goal resumes with your next message, and a goal that omp
  paused itself resumes as soon as Main works again.
- **Reviews you can trust.** Three blind review cycles with the reviewers
  `spotty`, `smarty` and `bossy` check the result against the agreement, and
  every finding rests on verbatim quotes.
- **Fast subagents.** Main writes briefs, `codebase_explorer` searches the code
  and external sources, `code_writer` writes the code and `shell_runner` runs
  tests, builds and applications. Each named agent runs on one fixed model;
  on your direct order Main runs the role-less agent `custom` on the model and
  reasoning level you name.
- **Memory that does not lose context.** Only LCM compacts the context: a
  native Rust module keeps background Haiku 5.5 summaries in SQLite, and search
  reaches the original messages. The autocompaction threshold is set by model
  family: all Claude models at 270 000 tokens, all GPT models at 258 400.
- **Tools at least as strong as Cursor's.** Reads and searches return up to
  100 000 characters without forcing rereads, subagent answers arrive in full,
  and `write`, replacement edits and `todo` run in parallel with other calls.
  GPT patches keep applicable files and hunks and return rejected parts with
  their errors; batch edits show the real line counts for each file.
- **A Cursor-style interface.** The `titanium-arq` theme follows Cursor Dark:
  black and graphite backgrounds, white-grey and grey text and no accent color,
  while green, yellow and red mark only statuses and diffs. Each item or result
  starts with the same circle `●` in one column. A tool call is one line with
  its status, verb, target and time; reads, searches, other tools and commands
  merge into "Explored". A long path loses its start so the file name and `+N −M`
  stay visible, and a finished turn folds into "Worked for". Ctrl+O expands
  tool results and the full to-do list; reasoning stays hidden. A shimmering
  phrase shows the current action without a timer. The session name is bold
  gold; the compaction bar uses the same natural gold at its trigger.
  The agent board shows the subagents on the left and a clear card
  of the selected one on the right. All interface text is plain English.
- **Small comforts.** `grep` runs on the `rg` engine,
  Mermaid diagrams appear as a PNG image across the full terminal width, the
  time of the last turn shows above the input field, shift+↑/↓ switch the model
  and shift+←/→ the reasoning.

The full build adds the owner's settings for omp (the `titanium-arq` theme, the
IosevkaTerm Nerd Font Mono font, context windows, status line and the other omp settings) and
our build of herdr, a terminal multiplexer with a Codex-style sidebar in the
same grey `titanium-arq` look. herdr is
built from a private fork and downloaded as a ready file from this repository's
`herdr` release. The harness was moved from the final version of
[my-codex-harness](https://github.com/ARQAWA/my-codex-harness).

## Installing on a new machine

1. Install omp with the stock installer: on macOS and Linux
   `curl -fsSL https://omp.sh/install | sh`, on Windows (PowerShell)
   `irm https://omp.sh/install.ps1 | iex`. Windows also needs Git for Windows;
   it can be installed for the current user only, without administrator
   rights. Start `omp` and sign in to the providers with `/login`.
2. Clone the repository into a permanent folder:
   `git clone https://github.com/ARQAWA/my-omp-harness.git ~/my-omp-harness`.
3. Start omp in this folder and ask: "Install everything per
   INSTALL_FOR_AGENTS.md". The agent applies the omp settings, installs the
   Nerd Font, connects the package, installs the system prompt and herdr and
   runs the checks. Then choose IosevkaTerm Nerd Font Mono as the terminal font,
   restart omp and start `herdr` in a new terminal window.

In the "Windows only inside VS Code" environment the installation order and the
way herdr and omp are started are different: see
[WORKING-ENVIRONMENTS.md](WORKING-ENVIRONMENTS.md).

## Updating

In the clone folder, ask omp: "Update everything per INSTALL_FOR_AGENTS.md".

## Documents

- [INSTALL_FOR_AGENTS.md](INSTALL_FOR_AGENTS.md) — the entry point for installation and updates.
- [install-instructions/omp.md](install-instructions/omp.md) — omp and the owner's settings.
- [install-instructions/harness.md](install-instructions/harness.md) — the harness package.
- [install-instructions/system-prompt.md](install-instructions/system-prompt.md) — the system prompt.
- [install-instructions/herdr.md](install-instructions/herdr.md) — our herdr.
- [AGENTS.md](AGENTS.md) — development and release.
- [WORKFLOW-CONCEPT.md](WORKFLOW-CONCEPT.md) — the core of the harness.
- [HARNESS-DESIGN.md](HARNESS-DESIGN.md) — the concept and decision history of the harness.
- [DESIGN-SYSTEM.md](DESIGN-SYSTEM.md) — the design system of the omp and herdr interface.
- [WORKING-ENVIRONMENTS.md](WORKING-ENVIRONMENTS.md) — the conditions of the working environments.
