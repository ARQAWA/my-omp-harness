# System prompt

General status and installation boundaries: [INSTALL_FOR_AGENTS.md](../INSTALL_FOR_AGENTS.md).

## Contents

[`SYSTEM.md`](../SYSTEM.md) at the root of the clone holds the general rules of
model behavior based on the GPT-5.5 prompt from
[`my-codex-harness`](https://github.com/ARQAWA/my-codex-harness/blob/68c2b109b473fd192ad1a86329336b996f5b95f4/new-model-instructions.md),
adapted to omp. It covers epistemic rigor, editing, engineering judgment,
continuity, formatting and progress updates; it does not contain harness
procedures or model routing.
The file is installed as a copy at `<agent-dir>/SYSTEM.md`. omp then replaces
its built-in instruction template with this file and keeps skills, rules and the
project context. The prompt applies to root Main and to every subagent in all
sessions of the profile. The prompt's version is the commit.

The todo, review and subagent rules belong to the harness package and are not
moved into the prompt. The package supplies execution policy and the owner's
reply format to root Main as skills: the Gold Standard, `omp-tools`,
`main-workflow`, `subagents` and `clear-communication`.

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
