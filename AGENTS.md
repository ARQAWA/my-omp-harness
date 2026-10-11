# Working base

This repository is the working base of the harness for omp: the system prompt,
skills, agents, extensions (including LCM), subagent model routing, the owner's
settings for omp and the delivery of our herdr. All of this is one harness.
It was moved from the final version of [my-codex-harness](https://github.com/ARQAWA/my-codex-harness) (commit
`13372c1`); that repository keeps the Codex version and the history of decisions
before the move.

Sources of truth:

- `package.json`, `extensions/`, `skills/` and `agents/`: the omp package;
- `SYSTEM.md`;
- `settings/`: the owner's settings for omp;
- `INSTALL_FOR_AGENTS.md` and `install-instructions/`;
- `WORKING-ENVIRONMENTS.md`: the conditions of the working environments,
  separate from the package documentation; write them abstractly and without
  sensitive details;
- `HARNESS-DESIGN.md`;
- `DESIGN-SYSTEM.md`: the visual rules of omp and herdr; every interface change
  follows it;
- `WORKFLOW-CONCEPT.md`: the core of the harness, see "Policy";
- the private fork `ARQAWA/herdr` (upstream `herdrdev/herdr`): the herdr sources.

`omp-vscode/` is an exceptional case: a special build for Windows only, a VS Code
extension for `win32-x64` with an `omp.exe` from an omp release built in. It
runs omp in Git Bash as child processes of the extension host without herdr and
updates it with `omp update` when VS Code starts. The ready VSIX lies in the
GitHub Release `omp-vscode`. The build is not part of the harness package and
its installation, and the repository's tooling rules do not apply to it. It has
no versions: the `version` field in its `package.json` exists only because the
VSIX does not build without it.

omp loads the package straight from the clone through `extensions`. On the
development machine the working tree of the main clone on `master` is the
installed copy: an edit there, even an uncommitted one, takes effect in the next
new omp session, and an edit in a task worktree takes effect after its branch is
merged into `master`. `SYSTEM.md` is installed as a separate copy.

The version is the commit. There are no version numbers or cachebusters. There
are three tags and GitHub Releases. `herdr` holds the ready herdr files from the
fork, `omp-vscode` the VSIX of the `omp-vscode/` extension, `lcm` the LCM native
modules `lcm_native.darwin-arm64.node` and `lcm_native.win32-x64.node`. A
release replaces their files.

## Local check of the sources

`node tests/run.mjs` (Node.js) is the single deterministic check of the
repository. It covers the package, routing, model mentions, agents, skills,
installation instructions and links. It does not start omp, does not change
settings and does not replace the post-installation checks on the target OS from
`install-instructions/*.md`.

## Policy

[`WORKFLOW-CONCEPT.md`](WORKFLOW-CONCEPT.md) is the core of the harness: the
manifest of the working concept, the problem it solves and its goals. Everything
in the repository aligns with it: on a divergence the rest changes, not the
manifest. Check every edit of prompts, skills, agents, extensions and
documentation against it. The manifest itself changes only by the owner's direct
edit, his direct request or explicit approval of a proposed change.

The Gold Standard sets an always-on exact scope, the shortest direct path with
the minimum of needed information and a minimal result. Heavy work (deep
research, comparing options, experiments, new tests, extra reviews and
subagents) runs only on a direct order. Quality adjectives do not widen the
scope.

Root Main automatically keeps a `todo` for every task except one answer or one
short action, and always for work with a review; the current item has a plan of
steps, and `step` marks the current step. For a task of several dependent stages Main sets
an omp goal (`goal`) itself. The list holds stages with draft decisions; findings
lie in `local://` files named in the items. A direct request requires a todo,
"without todo" excludes it. Before work with changes, except point corrections
with an obvious meaning (micro), Main splits the request into checkable
requirements and confirms them with the user in one `ask` together with the
work class: small is up to 5 requirements and up to 5 changed files, large is
more. Root Main gets these rules and the plan-mode checks in the hidden skill
`main-workflow`. Review runs automatically by the work class: micro without a
check, small is checked by Spotty before handover, large by Smarty. In
`/define-goal` the accepted goal replaces the requirement step: `harness.ts`
registers the command and supplies the procedure `extensions/define-goal.md`;
in plan mode and with an active or paused goal the command only shows a notice.
The goal carries verbatim user quotes and a Review section with the class, the
user accepts it from a short retelling in the chat, and before completing the
goal the agent itself runs the reviewer of the class until CLEAN.
The other automatic reviews are two Light Review (Spotty) checks in omp plan
mode (the plan before it is proposed for approval and the result of carrying out
the approved plan) and the mandatory finalization gate below, which runs in
parallel with the class check; every check runs until CLEAN. Bossy runs only on
the user's explicit choice. Review findings and rejections rest on verbatim
quotes of the agreement and the object.

Root Main does not write code and configs itself: only `code_writer` writes
sources, scripts, tests and configuration files from Main's self-contained
briefs, and Main writes documentation and prompts itself. Root Main runs
programs (tests, builds, applications, `omp -p`) only through `shell_runner`,
and reads state, runs git and does file operations itself. Main hands searches
over unfamiliar files, several rounds of searching, external sources and
material larger than its context to `codebase_explorer`. These rules, the
subagent types with their models and the reuse rule live in the hidden skill
`subagents`, which `harness.ts` gives only to root Main; the briefing rules lie
in the visible skill `subagent-brief`, which Main reads before a brief. Main
launches only the harness agents from `agents/*.md`; omp's built-in agents are
turned off by `task.disabledAgents`. A subagent on a model of the user's choice
is the role-less agent `custom`, launched only on the user's direct order.

### Languages

The owner writes his requests in Russian, and agents answer him in the chat in
Russian. Everything else that the owner and agents read or follow is in
English: `skills/`, `agents/`, `SYSTEM.md`, `extensions/define-goal.md`,
`.agents/skills/`, `AGENTS.md`, `README.md`, `INSTALL_FOR_AGENTS.md`,
`install-instructions/` and `DESIGN-SYSTEM.md`. Texts for agents use precise English that leaves an
agent no doubt about what to do. Every text that the extensions show in the
terminal is plain English at A2 level, without Russian. The design files
`HARNESS-DESIGN.md` and `WORKING-ENVIRONMENTS.md` stay in Russian, because the
owner reads them. Russian stays in an English file only where an agent must
give it to the owner word for word, such as the options «Начинаем» and
«Поправить» or the list of Russian filler phrases in `SYSTEM.md`, and where it
is a trigger word of the owner, such as «релиз».

### Branches, worktrees and commits

Every task with changes runs in its own branch and its own git worktree, so
that agents working at the same time never touch each other's files. Start it
from the main clone on an up-to-date `master`:
`git worktree add -b <task> ../my-omp-harness-worktrees/<task> master`, where
`<task>` is a short name of the task. All edits of the task are made in that
worktree. Commit every finished stage of the task to its branch at once, with
`git add` of the exact paths of the stage; these stage commits need no checks,
review or gate. Never commit to `master` directly. The branch reaches `master`
only through a full release by `.agents/skills/release/SKILL.md`: the checks and
the finalization gate, the merge into `master`, push and installation. The
merge into `master` is always a squash merge: the whole task lands as one
commit. After the merge the task's worktree and branch are deleted.

### Mandatory finalization gate

Before handing over a task with changes in this repository, before the merge
into `master`, push and completing a release, Main ensures that
[finalize-work](.agents/skills/finalize-work/SKILL.md) is applied: Main reads and
carries it out. It is the user's standing direct order for a blind Spotty review
of the consistency of the code and all documentation of the delivered result,
and of the absence of outdated standing information, junk and conflicts. The gate
also compares the machine's local omp settings (`config.yml`, `models.yml`,
`keybindings.yml`, the theme, the `SYSTEM.md` copy) with their sources in the
repository and moves local changes into the sources together with the other
edits. The gate applies to documentation edits too; stage commits to a task
branch do not need it. Before the merge into `master`, push and release the
object of the gate is the whole repository, not only the task's changes: the gate finds divergences left from earlier edits and removes what was
abolished (a model, an agent, a skill, a setting, a file, a rule) everywhere it
still stands: in code, commented-out code, tests, settings and documents; the
history stays in Git.
Without CLEAN from a fresh Spotty, completion, the merge into `master` and push
are forbidden.
Significant findings are fixed until CLEAN by the skill's procedure. Do not
repeat a gate already passed for an unchanged result and grounds. The gate itself
does not authorize publication.

### Model routing

`extensions/subagent-model-policy.ts` sets the subagents' models. Each named
agent has one model in the `NAMED` table under any parent: `spotty` is Haiku 5.5
low, `smarty` Haiku 5.5 medium, `bossy` Sonnet 5.5 low, and `codebase_explorer`,
`code_writer` and `shell_runner` Haiku 5.5 high. The agent `custom` gets the
model and effort of its `task` item through the extension's `task` wrapper.
The extension blocks no launch. `agents/*.md` have no `model` field.

A new agent is a file `agents/<name>.md`, a line in `NAMED`, a line in
`skills/subagents/SKILL.md` and a row in the agent table of
`install-instructions/harness.md`.

The owner chooses the models. When a model changes, update together:

- `NAMED`, the line of the agent in `skills/subagents/SKILL.md` and the agent
  table in `install-instructions/harness.md`;
- the startup model in `extensions/default-model.ts`;
- the shift+↑/↓ list in `extensions/model-arrows.js` and the context windows in
  `settings/models.yml`;
- the autocompaction thresholds in `extensions/autocompaction.ts` and their
  description in `README.md` and `install-instructions/harness.md`;
- `enabledModels` in step 4 of `install-instructions/omp.md` and the local
  setting.

`node tests/run.mjs` checks the extension against the list above: every agent
file is named in the `subagents` skill, the `NAMED` models match the readable
names in the skill and the table in `harness.md`, and the model IDs match in
`model-arrows.js` and `settings/models.yml`; `enabledModels` is updated by hand.
The finalization gate covers the rest. After a change on the development
machine, start a new omp session.

### Rules for working with the sources

The omp providers determine which models are available. The repository pins the
models in the routing extension and in the places listed above.

The owner's omp settings live in `settings/` and in step 4 of the first
installation in `install-instructions/omp.md`; the package keys are in
"Requirements" of `install-instructions/harness.md`. Every change of the omp
settings on the development machine goes there at once, so that the installation
gives the same configuration. The finalization gate compares the local omp
settings with these sources.

The harness is installed on top of stock omp and does not patch or fork it:
omp behavior changes only through extensions via the public API, `config.yml`
settings and the settings files from `settings/`, so that `omp update` does not
break them. What cannot be done without forking omp is not done.

The usual check is reading and logic. After code or configuration changes, run
the existing checks covering the change (`node tests/run.mjs`) once, in the
background where possible; repeat only after fixing a failure they revealed. Fix
failures caused by the change, including earlier assertions about deliberately
changed behavior; report unrelated failures without repairing them. New tests,
fixtures, measurements, experiments and checks beyond those covering the change
run only on a direct request or under a concretely adopted procedure.

For check runs use `omp -p` with Main `openai-codex/gpt-6.1-sol` or
`anthropic/claude-sonnet-5-5` and `--thinking low`; do not raise the model and
reasoning.

Keep the user's changes. In a migration, do not change the location, format or
value of secrets without a request.

A new version of `master` and installation do not follow from ordinary editing;
ordinary editing ends with stage commits to the task branch. Temporary task
files are created only in the OS temporary folder, which the system cleans, so
they are not deleted. The owner's words release, commit, push and sync equally
mean a full release in one package: syncing the local settings with the sources,
all checks and the finalize-work gate, the merge of the task branch into
`master`, push and installation on the current host. Spotty controls the
package: without its CLEAN on the whole repository, the merge into `master` and
push are forbidden, and a separate merge or push without the rest of the package
is not done. The release order is described
in `.agents/skills/release/SKILL.md`.

`INSTALL_FOR_AGENTS.md` is the single entry point for installation and updates.
The sources of installation actions are this entry document, the instruction of
the selected component from `install-instructions/` of the same revision and its
explicitly named dependencies. The repository's `AGENTS.md` describes development
and lies outside the installation procedure. There are four components: omp with
the owner's settings (`install-instructions/omp.md`), the harness package
(`install-instructions/harness.md`), the system prompt
(`install-instructions/system-prompt.md`) and herdr
(`install-instructions/herdr.md`). All instructions keep the common order of
sections: contents, requirements, first installation, post-installation check,
update.

Instructions and links to them are not part of `extensions/`, `skills/` and
`agents/`. The system prompt is a separate delivery component; its source is
`SYSTEM.md`.

Save JSON in UTF-8 with readable characters, without replacing Cyrillic with
Unicode sequences like \uXXXX; when reserializing, do not change field values.

`install-instructions/*.md` and reference texts must be short and meaningful.
Describe the concrete contents, the separately connected parts and the package's
readiness. Instructions need clear installation and update steps with `git` and
`omp config` commands; the system prompt instruction uses `omp config path`, the
herdr instruction uses `curl`, and on Windows `powershell.exe`.
Sufficient commands and setting examples are allowed here; they do not move into
runtime skills. The checks from the selected `install-instructions/*.md`
document are run by the installing agent at the end of the installation on the
target OS. On Windows, through the omp bash tool or Git Bash; the result of
another OS does not prove that Windows works. Editing sources and documentation
does not by itself start these checks. On update, keep data, secrets and other
people's settings; repeat only the required checks of the affected parts. The
user's explicit ban on check runs takes priority. Do not turn on unrelated host
functions because their name resembles the package name.

The design file `HARNESS-DESIGN.md` describes the harness and its necessary
external contracts. The repository's general rules are kept in AGENTS.md.

The design file describes the current concept of the harness: purpose, problems,
context, current proposals, adopted decisions, the user's agreements and the
reasons for the structure. Distinguish a proposal, an agreed decision and an
actually made change; do not attribute agreements or results. Earlier versions
are available in the Git/GitHub history. Do not put working TODOs, execution
queues and release checklists into the design. The current plan and work status
are kept in a sufficient primary source or in `todo`. The current installation
instructions are in `install-instructions/`.

When removing a component or code or abandoning a decision, remove its current
sources and documentation. Do not create archive copies, notes, records of
removal or abandonment to keep the past: the Git/GitHub commit history serves
that. The rule applies in this repository. It does not allow deleting user data
and does not cancel documentation of current decisions and completed work.

After installation the package is self-contained and does not depend on the
repository's documentation. Installation and updates use the document of the
selected revision. This file sets the rules for working on the sources.

Do not add setup skills. Do not refer to the working repository in package files.

The model's general instructions describe behavior and working principles
without binding to specific functions, commands and environment variables.
`SYSTEM.md` is the general rules based on the final Codex system prompt without
the parts that do not exist in omp, and it reaches every agent, subagents
included. Rules supplied by the package's skills are not repeated in it: the
package supplies root Main with the Gold Standard, `omp-tools`, `main-workflow`,
`subagents` and `clear-communication`, and a subagent gets `SYSTEM.md`, its
definition, its brief and `omp-tools`. The todo and review rules belong to the
package; changes of these rules are not moved into the base prompt. The
mechanics of the tools come from the descriptions of the omp tools themselves;
the `omp-tools` skill adds to them only the rules of speed, temporary files and
protection against frequent mistakes, and the search is set by `extensions/rg.ts`
and the `codebase_explorer` definition.

All of the project's own tooling is implemented in Node.js or as omp extensions
(TypeScript that omp runs) and must work on macOS, Linux and Windows. The
exception is the LCM core: the Rust crate `crates/lcm-native` is built into a
Node-API module that the `extensions/lcm` extension loads into the omp process.
Only GitHub Actions `.github/workflows/lcm-native.yml` builds the ready modules
for macOS Apple Silicon and Windows x64 on its own machines and puts them into
the GitHub Release `lcm`; they are not kept in Git. The script
`node crates/lcm-native/build.mjs` builds them locally only for development and
checks. On Windows work through the omp bash tool or Git Bash. PowerShell and
cmd are forbidden, except in the two places named in `INSTALL_FOR_AGENTS.md`:
the stock omp installer and the `powershell.exe` call in the herdr instruction.

## Simple tooling

Build tooling in the simplest sufficient way: instructions, prompts, skills,
subagents, omp extensions, packages and ordinary Node.js CLI tools. Do not
complicate this mechanics without the user's direct request.

## History

The history before the move and its sources are in the
[my-codex-harness](https://github.com/ARQAWA/my-codex-harness) repository. The
decisions of the move to omp are described in the last sections of
`HARNESS-DESIGN.md`.

Do not carry earlier repeated reviews or cleanups of one release into every
future run.
