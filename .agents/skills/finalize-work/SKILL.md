---
name: finalize-work
description: "Mandatory finalization of changes in this repository before handing over a task, committing, pushing or finishing a release. Select this skill automatically: reconcile the local omp settings with their repository sources, then a blind smarty review checks that the code and all documentation of the result agree and that no outdated information, junk or conflict remains; completion is forbidden without CLEAN."
---

# Work finalization

The owner's standing instruction in `AGENTS.md` makes this gate mandatory for every task that changes this repository, documentation included, and for every commit, push and release. Discussion and read-only analysis do not start it. The gate alone permits no commit, push, release or installation.

## Consistency

The object depends on the moment. When handing over a task, it is the result: its code, configuration and every document that describes it, including unchanged related ones such as instructions, design files, skill descriptions, contracts in `AGENTS.md`, links and examples, and the interaction of several components. Before a commit, push or release, it is the whole repository: all code, configuration, tests, skills, agents, settings, instructions, `AGENTS.md` and the design file, whether or not the task touched them. The owner makes fast edits and this gate keeps the repository from drifting apart, so it also finds drift left by earlier changes. Leave out other people's unfinished changes, refactoring and cosmetic cleanup.

Bring the code and the documents into agreement with the current request and the accepted decisions, in both directions: neither side is right by default. Remove contradictions, wrong links and examples, outdated standing statements, needless duplicates and leftover junk. Whatever a rework or a decision abolished, such as a model, an agent, a skill, a setting, a file or a rule, is removed everywhere it still stands: code, commented-out code, tests, settings, lists, counts, documents and examples. History stays in Git, so make no archive copies or removal notes; this does not remove the documentation of current decisions and finished work. Ask the owner when a fix needs a decision you lack or goes beyond the order.

## Local settings

Every run also compares the owner's omp settings on this machine with their sources, whether or not the task touched them. `<agent-dir>` is the directory `omp config path` prints.

| Local | Repository source |
|---|---|
| `omp config list` (`<agent-dir>/config.yml`) | step 4 of `install-instructions/omp.md`; keys owned by the package in «Требования» of `install-instructions/harness.md` |
| `<agent-dir>/models.yml` | `settings/models.yml` |
| `<agent-dir>/keybindings.yml` | `settings/keybindings.yml` |
| `<agent-dir>/themes/titanium-arq.json` | `settings/titanium-arq.json` |
| `<agent-dir>/SYSTEM.md` | `SYSTEM.md` |

Write a local value that differs from its source, or an owner setting present only locally, into the matching source (`code_writer` writes configuration files, Main the documents) and the documents that describe it, so it is reviewed and committed with the other changes. When the task changed a source, bring the local copy to it by the installation instructions. Ask the owner when the direction is unclear. Never transfer `modelRoles.default`, `setupVersion`, secrets, credentials, account data or other machine-specific values.

## Review

Run [blind-review-cycle](../../../skills/blind-review-cycle/SKILL.md) with `smarty`; this gate is the owner's standing order for that cycle. In the brief, give the object's boundaries and paths, `WORKFLOW-CONCEPT.md` and the settings comparison as evidence, and set the criterion: the code and all documentation of the object agree with each other and with `WORKFLOW-CONCEPT.md`, and no outdated standing information, junk or conflict remains. Use `review_stage=pre-action` before a commit or push and `pre-completion` before handing over. A CLEAN on the same whole object with this criterion, including one from another review, holds for the later commit, push and final answer while the object and its bases stay unchanged.

Before a commit, push or release the object is the whole repository. Split it into parts by the size rule of the cycle, each listed by paths so that no file is left out, keeping related files together: code with its tests, skills with agents and `SYSTEM.md`, settings with install documents, and `AGENTS.md`, `WORKING-ENVIRONMENTS.md` with the design file. Run one fresh smarty per part in parallel, each with the criterion above. Give every reviewer the list of what `git diff origin/master` removed or renamed, and ask it to check each fact its part states or relies on, such as model lists, windows and thresholds, names and counts of agents and skills, commands, paths and line references, against every other file that states it, and to search the whole repository for what was abolished.

Without CLEAN, do not report the work complete, commit or push. If smarty cannot start, the gate has not passed. The gate needs no tests, builds or runs. Report its result or its blocker in the final answer.
