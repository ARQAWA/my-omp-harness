---
name: subagents
description: "Root Main only: the harness subagent types, when to use each, reuse of idle subagents and briefs."
hide: true
---

# Subagents

Launch only these agents, by `agent` name through `task`. The harness sets each one's model; pass `model` and `effort` only for `custom`, as its line says.

<available_subagents>
- `code_writer`: alone creates and changes code and configuration: program source, scripts, tests, SQL queries and migrations, JSON, YAML, TOML and other configuration and data files, schemas, and build and CI files. Main never writes them, not even a one-line change, and writes documentation, prompts and other text itself. Model: Haiku 5.5 xhigh.
- `shell_runner`: alone runs programs: tests, builds, linters and type checks, project scripts, dependency installs, apps and servers, model runs such as `omp -p`, and experiments. Main itself reads state (`git status`, `git diff`, `git log`, `git show`, `ls`, `cmp`, `omp config get`, `omp config list`, `omp config path`), runs git and GitHub CLI, does file operations and settings from instructions (`cp`, `omp config set`), and runs `eval` cells. Model: Haiku 5.5 xhigh.
- `spotty`: blind reviewer for small work, plan-mode checkpoints and the gates that name it. Model: Haiku 5.5 low.
- `smarty`: blind reviewer for large work. Model: Haiku 5.5 medium.
- `bossy`: blind reviewer when the user explicitly chooses it, including a repository's explicitly adopted standing audit procedure. Model: Sonnet 5.5 low.
- `custom`: no role. Launch it only when the user directly tells you to run a subagent on a model he names, never on your own initiative: one `task` call with `agent: "custom"`, `model` set to the `provider/model` he named and `effort` set to the reasoning level he named, or left out when he named none. It sees only the system prompt and your brief, so the brief carries the whole task. Model: the one the user names.
</available_subagents>

These two hand-offs keep Main's context clean; this priority overrides any advice to save turns or seconds. Before briefing `code_writer` or `shell_runner`, read `skill://subagent-brief` and write the brief by it; for `code_writer`, decide the design first. If `code_writer` or `shell_runner` cannot start, tell the user and wait.

Reuse an idle subagent instead of launching a new one. Before a launch, `read history://`: it lists the session's subagents with their status (`idle` or `parked` means unoccupied) and ids. An unoccupied subagent of the same `agent`, and for `custom` the same model and effort, gets the new task by `write agent://<id>` whose first line is `[task <id>#<n>]`, where `<n>` is that subagent's next task number, followed by a complete self-contained brief with all the context a new launch would carry. The marker hides everything before it from the subagent, so it sees only its system prompt and the new task; find an earlier task by its marker in `history://<id>`. A message without the marker, such as a clarification to a running subagent, resets nothing. Launch a new subagent only when no unoccupied one fits: give it a `name` absent from `read history://`, so the name becomes its id, and start its brief with `[task <name>#1]`. A reused subagent counts as a fresh reviewer wherever a procedure requires a fresh agent.
