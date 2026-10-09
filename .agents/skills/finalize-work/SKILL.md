---
name: finalize-work
description: "Mandatory finalization of changes in this repository before handing over a task, committing, pushing or finishing a release. Select this skill automatically: reconcile the local omp settings with their repository sources, then a blind smarty review checks that the code and all documentation of the result agree and that no outdated information, junk or conflict remains; completion is forbidden without CLEAN."
---

# Work finalization

The owner's standing instruction in `AGENTS.md` makes this gate mandatory for every task that changes this repository, documentation included. Discussion and read-only analysis do not start it. The gate alone permits no commit, push, release or installation.

## Consistency

The object is the result being handed over: its code, configuration and every document that describes it, including unchanged related ones such as instructions, design files, skill descriptions, contracts in `AGENTS.md`, links and examples, and the interaction of several components. Leave out unrelated components, other people's unfinished changes, refactoring and cosmetic cleanup.

Bring the code and the documents into agreement with the current request and the accepted decisions, in both directions: neither side is right by default. Remove contradictions, wrong links and examples, outdated standing statements, needless duplicates, leftover junk, and the parts a rework made obsolete. History stays in Git, so make no archive copies or removal notes. Ask the owner when a fix needs a decision you lack or goes beyond the order.

## Local settings

Every run also compares the owner's omp settings on this machine with their sources, whether or not the task touched them. `<agent-dir>` is the directory `omp config path` prints.

| Local | Repository source |
|---|---|
| `omp config list` (`<agent-dir>/config.yml`) | step 4 of `install-instructions/omp.md`; keys owned by the package in «Требования» of `install-instructions/harness.md` |
| `<agent-dir>/models.yml` | `settings/models.yml` |
| `<agent-dir>/keybindings.yml` | `settings/keybindings.yml` |
| `<agent-dir>/themes/titanium-arq.json` | `settings/titanium-arq.json` |
| `<agent-dir>/SYSTEM.md` | `SYSTEM.md` |

Write a local value that differs from its source, or an owner setting present only locally, into the matching source and the documents that describe it, so it is reviewed and committed with the other changes. When the task changed a source, bring the local copy to it by the installation instructions. Ask the owner when the direction is unclear. Never transfer `modelRoles.default`, `setupVersion`, secrets, credentials, account data or other machine-specific values.

## Review

Run [blind-review-cycle](../../../skills/blind-review-cycle/SKILL.md) with `smarty`; this gate is the owner's standing order for that cycle. In the brief, give the result's boundaries and paths and the settings comparison as evidence, and set the criterion: the code and all documentation of the result agree, and no outdated standing information, junk or conflict remains. Use `review_stage=pre-action` before a commit or push and `pre-completion` before handing over. A CLEAN on the same whole result with this criterion, including one from another review, holds for the later commit, push and final answer while the result and its bases stay unchanged.

Without CLEAN, do not report the work complete, commit or push. If smarty cannot start, the gate has not passed. The gate needs no tests, builds or runs. Report its result or its blocker in the final answer.
