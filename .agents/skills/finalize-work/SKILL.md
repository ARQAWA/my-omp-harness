---
name: finalize-work
description: "Release-time finalization of this repository: two independent Spotty checks reconcile local omp settings with their sources and the release diff with related documentation. Ordinary handover and task-branch stage commits skip it; a clean repo-audit replaces only the diff check."
---

# Work finalization

Run during a release, before the squash merge into `master` and push. Ordinary task handover, task-branch stage commits, discussion and read-only analysis do not start it. Handover uses only the completion check of the work class. Finalization alone authorizes no publication or installation.

## Prepare

In the task worktree, incorporate the current `master` before gathering evidence. Main obtains the local directory with `omp config path`, captures `omp config list`, compares the four file pairs below with `cmp`, and prepares `git diff --find-renames master...HEAD` with its changed-path list. Include any subsequent uncommitted finalization fixes in the next diff, or commit them to the task branch before regenerating it. Store reviewer evidence in the OS temporary directory; exclude secrets and machine-specific data.

Run two independent [Light Review Cycle](../../../skills/light-review-cycle/SKILL.md) checks with `spotty` in parallel, each with its own brief and `review_stage=pre-action`. If the release is also handing over the task, run any still-required class check in the same wave. Neither finalization check reviews the whole repository.

## Local settings check

| Local | Repository source |
|---|---|
| `omp config list` (`<agent-dir>/config.yml`) | step 4 of `install-instructions/omp.md`; package keys in "Requirements" of `install-instructions/harness.md` |
| `<agent-dir>/models.yml` | `settings/models.yml` |
| `<agent-dir>/keybindings.yml` | `settings/keybindings.yml` |
| `<agent-dir>/themes/titanium-arq.json` | `settings/titanium-arq.json` |
| `<agent-dir>/SYSTEM.md` | `SYSTEM.md` |

Give Spotty the comparison output, the owned configuration values and their sources. For equal file pairs, the comparison output suffices; for differing pairs, provide the relevant file contents without private values. Its criterion is that the owner's current mechanical omp configuration is reflected in the repository sources, and source changes from this task are applied locally by their installation instructions. This check covers settings only, not the release diff or unrelated documentation.

Main reconciles admitted differences: preserve owner values present only locally in the appropriate sources and their descriptions; apply deliberate task changes from the sources locally. `code_writer` changes configuration files, Main changes documentation. Ask the owner in chat when the direction is unclear. Never copy `setupVersion`, credentials, secrets, account data or machine-specific values. Recompare after reconciliation and give a fresh Spotty the updated evidence until CLEAN.

## Release diff check

Give the second Spotty the complete release diff, changed files, the accepted requirements and the relevant contracts in `AGENTS.md`. Its criterion is that every fact changed by the release agrees with the code and every document that states or relies on that fact. Changed names, values, counts, paths, commands and behavior must have all required references; search for removed or renamed elements across the repository and clear obsolete references in every file that states or relies on them. History belongs in Git, not archive copies or removal notes.

Read the diff and changed files first. Use a targeted repository search for the facts the diff changes, then read the matching dependent files, including unchanged ones. Check code and documentation in both directions; neither is right by default. Do not scan unrelated facts, audit historical drift, refactor or perform cosmetic cleanup. Ask the owner in chat if a repair needs a decision outside the agreement.

A CLEAN [repo-audit](../repo-audit/SKILL.md) on the same result covers this criterion and replaces this diff check; it never replaces the local settings check. When an audit is due, run it in parallel with the settings check rather than launching the second Spotty.

## Completion

Fix admitted findings in one batch. Repeat only the cycle whose evidence or checked facts the fixes change; a cross-check dependency invalidates both affected results. Reuse CLEAN while its object and grounds remain unchanged, including across staging, a content-equivalent squash merge and installation. Neither cycle adds test runs; existing checks follow the repository's normal rules.

Merge and push require CLEAN for local settings and either the release diff or its covering audit. If a required reviewer cannot start, report the blocker and wait. Report the finalization results when handing over the release.
