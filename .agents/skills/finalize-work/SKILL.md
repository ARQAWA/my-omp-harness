---
name: finalize-work
description: "Release-time finalization: reuse unchanged Spotty settings evidence and combine the task and release-documentation criteria in one work-class review. Micro releases use a diff-only Spotty; a due Bossy audit runs after ordinary repairs and covers documentation consistency."
---

# Work finalization

Run during a release before the squash merge into `master` and push. Ordinary handover, task-branch stage commits, discussion and read-only analysis do not start this gate. Finalization alone authorizes no publication or installation.

## Prepare

Incorporate current `master` in the task worktree. Main obtains the local directory with `omp config path`, captures the source-owned values from `omp config list`, compares the four file pairs below with `cmp`, and prepares `git diff --find-renames master...HEAD` and its changed paths. Include subsequent uncommitted fixes in refreshed evidence, or commit them to the task branch before regenerating it. Keep temporary reviewer evidence in the OS temporary directory; exclude secrets and machine-specific data.

Settings and documentation remain separate checks with separate inputs and coverage. Apply the shared [Blind Review Cycle](../../../skills/blind-review-cycle/SKILL.md) coverage and reuse rules; do not start another reviewer merely because the task reached a new stage or got a new commit ID.

## Local settings check

| Local | Repository source |
|---|---|
| `omp config list` (`<agent-dir>/config.yml`) | step 4 of `install-instructions/omp.md`; package keys in "Requirements" of `install-instructions/harness.md` |
| `<agent-dir>/models.yml` | `settings/models.yml` |
| `<agent-dir>/keybindings.yml` | `settings/keybindings.yml` |
| `<agent-dir>/themes/titanium-arq.json` | `settings/titanium-arq.json` |
| `<agent-dir>/SYSTEM.md` | `SYSTEM.md` |

Compare the current inputs with the last actual Spotty CLEAN using retrievable existing evidence. Here task notes mean the `local://` working files already referenced by Main's `todo`, as defined by Main Workflow; an existing reviewer-result artifact can also provide the evidence. The verdict covers only the input contents and criterion actually reviewed; it is not authority to skip changed or unchecked inputs. No additional file name, storage location, metadata format or service is required.

The evidence must establish the actual Spotty verdict, its checked criterion and scope, the owned local and expected values, both sides of each file comparison and the source statements defining the settings contract. Include additional explicit owner settings requiring preservation. Use existing evidence rather than imposing a new record schema. Exclude credentials, secrets, `setupVersion`, account data, machine-specific values and unowned stock defaults, as in the normal settings reconciliation.

Recompare live inputs at each release. Reuse CLEAN only when its evidence exists and every checked value, file content, source contract, scope and criterion still matches. An unrelated document edit, staging or a content-equivalent squash does not invalidate it. Changed inputs, an actual mismatch, incomplete evidence or no prior CLEAN requires [Light Review Cycle](../../../skills/light-review-cycle/SKILL.md) with `spotty`, `review_stage=pre-action`.

Give Spotty the comparisons and the relevant source statements; equality evidence suffices for equal file pairs, and differing pairs need their relevant contents without private values. Its criterion is that the owner's current mechanical omp configuration is reflected in its repository sources and deliberate task changes are applied locally by their installation instructions. This check covers settings, not unrelated documentation or the task requirements.

Main reconciles admitted differences: preserve local owner values in the appropriate sources and their descriptions; apply deliberate source changes locally. `code_writer` changes configuration, Main changes documents. Ask the owner in chat if direction is unclear. After repairs, recompare and repeat fresh Spotty passes until CLEAN, then retain the evidence of that actual result in the task notes. Never infer Spotty CLEAN from equality alone or from a repository audit.

## Task and release documentation

The documentation criterion is that every changed fact agrees with the code and all documents that state or rely on it. All changed names, values, counts, paths, commands and behavior need their required references. Search removed or renamed elements across the repository and clear obsolete references wherever they stand; leave history in Git, not archives or removal notes. Read the complete release diff and changed files, then use targeted searches to find dependent documents, including unchanged ones. Do not audit unrelated historical drift or add cleanup outside the changed contract.

For small or large tasks, the required class pass must combine this criterion with the task requirements: Spotty for small, Smarty for large, one brief containing both criteria, the full diff and dependent sources. At handover Main Workflow obtains that combined coverage without starting settings reconciliation or an audit; reuse its CLEAN at release while all covered inputs and grounds match. If a class CLEAN was already obtained without documentation coverage, retain it and run only the missing documentation check with Spotty. When both criteria need a fresh review, use one combined class pass rather than two overlapping reviewers.

Micro has no handover class review; at release, obtain the documentation coverage with a diff-only Spotty unless an unchanged covering result already exists. A CLEAN [repo-audit](../repo-audit/SKILL.md) on the prepared result covers this documentation criterion, never settings or the required class review. When an audit is due, finish any required class check and ordinary repairs first, then obtain the documentation coverage from that audit instead of a duplicate diff-only pass. A combined class pass already obtained need not be repeated just because an audit follows.

## Completion

Complete normal edits and reconcile known settings differences before launching review on a frozen result. Run independent settings and combined task checks in parallel; wait for their complete verdicts before one batch of repairs. Run a due repository audit only after ordinary work and its admitted findings are settled, then repair and recheck only the audit parts and prior checks whose files, values or dependent facts those repairs change.

Merge and push require valid CLEAN coverage for settings and documentation and any mandatory work-class review. Reuse unchanged coverage through staging, content-equivalent squash and installation. These checks add no test runs: reuse existing test evidence for unchanged tested inputs and repeat only a check whose coverage was affected. If a required reviewer cannot start, report the blocker and wait. Report the finalization results at release handover.
