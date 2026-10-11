# System prompt

General status and installation boundaries: [INSTALL_FOR_AGENTS.md](../INSTALL_FOR_AGENTS.md).

## Contents

[`SYSTEM.md`](../SYSTEM.md) at the root of the clone holds the general rules of
model behavior based on the final Codex system prompt, without the parts that do
not exist in omp and without the rules that the harness package's skills supply.
It ends with the "Subagent model routing" section: choosing a complexity tier,
starting the named harness agents by name without `model`, and the work that
root Main hands to them: searching unfamiliar files and external sources goes to
`codebase_explorer`, code and configs only to `code_writer`, program runs only
to `shell_runner`.

The file is installed as a copy at `<agent-dir>/SYSTEM.md`. omp then replaces
its built-in instruction template with this file and keeps skills, rules and the
project context. The prompt applies to root Main in all sessions of the profile;
subagents do not receive it, because the harness package removes it from their
system prompt. The prompt's version is the commit.

The todo and review rules belong to the harness package and are not moved into
the prompt. The prompt is tied to the package by the routing section (the routes
are set by the `subagent-model-policy.ts` extension, the briefs by the
`subagent-brief` skill) and by the skills that the package supplies to root Main
instead of repeating them in the prompt: the Gold Standard, `omp-tools`,
`main-workflow` and `clear-communication`.

## Requirements

You need the installed [harness package](harness.md) and access to `<agent-dir>`,
the directory that `omp config path` prints; it follows the active profile. On
Windows, run commands through the omp bash tool or Git Bash. Do not carry over
absolute paths from another machine.

## First installation

Set the clone path and the agent directory:

```bash
CLONE="$(git -C ~/my-omp-harness rev-parse --show-toplevel)"
AGENT_DIR="$(omp config path)"
```

If `$AGENT_DIR/SYSTEM.md` does not exist, copy the source unchanged:
`cp "$CLONE/SYSTEM.md" "$AGENT_DIR/SYSTEM.md"`.

If the file exists and differs, it may be the owner's own prompt. Show the
differences with `git diff --no-index "$AGENT_DIR/SYSTEM.md" "$CLONE/SYSTEM.md"`
and replace the file only with the owner's consent.

The prompt takes effect in a new omp session. Do not interrupt the current task
to restart.

## Post-installation check

The command `cmp "$CLONE/SYSTEM.md" "$(omp config path)/SYSTEM.md"` prints
nothing. No model runs are needed.

## Update

After updating the clone, run the same `cmp` command. If it reports a
difference, copy the file again as in the first installation. Do not overwrite a
matching file. Then repeat the check and start a new session without
interrupting the current task.
