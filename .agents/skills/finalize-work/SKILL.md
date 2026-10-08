---
name: finalize-work
description: "Mandatory finalization of changes in this repository before handing over a task, committing, pushing or finishing a release. Select this skill automatically: a blind Smarty reviewer checks the consistency of the code and all documentation of the result, outdated information, junk and conflicts, after the local omp settings are reconciled with their repository sources; completion is forbidden without CLEAN."
---

# Work finalization

The gate is mandatory under the user's standing instruction in `AGENTS.md`.
It applies to tasks that change this repository, including documentation-only
changes. Pure discussion or read-only analysis does not start it.
The gate does not permit commit, push, release or installation without a separate request.

## Object and consistency

Determine the result to be handed over from the user's request and the actual
changes. Include code, configuration and all documentation that describes this
result, including unchanged related documents: instructions, design, skill
descriptions, contracts in `AGENTS.md`, links and examples. For several
components also check their described interaction. Do not limit yourself to the
diff list; do not include unrelated components and other people's unfinished
changes.

Reconcile the implementation and the documents in both directions with the agreed
result. Eliminate contradictions, wrong links and examples, outdated standing
instructions, unneeded duplicates and temporary junk in this area. When code and
a document disagree, you must not automatically treat either one as right: the
basis is the current request and the accepted decisions. Ask the user for a
missing material decision.

If an agreed rework makes the previous implementation unnecessary, remove its
related obsolete parts in the affected area under Gold Standard. Do not create
archive copies or cancellation records for the sake of preserving the past:
history stays in Git. Keep information about the standing decision, the necessary
evidence, other people's work and user data. Unrelated historical materials are
not part of this task's cleanup. If a fix requires going outside the order's
scope or an ambiguous deletion, stop the affected gate and name the decision that
is needed. General refactoring and cosmetic cleanup are not part of this check.

## Local settings

Every gate run also reconciles the owner's omp settings on the current machine
with the repository, whether or not the task touched them. `<agent-dir>` is the
directory printed by `omp config path`. Compare:

| Local | Repository source |
|---|---|
| `omp config list` (`<agent-dir>/config.yml`) | step 4 of `install-instructions/omp.md`; keys owned by the package in «Требования» of `install-instructions/harness.md` |
| `<agent-dir>/models.yml` | `settings/models.yml` |
| `<agent-dir>/themes/titanium-arq.json` | `settings/titanium-arq.json` |
| `<agent-dir>/SYSTEM.md` | `SYSTEM.md` |

A local value that differs from its source, or an owner setting present locally
and absent from the sources, is a local change: write it into the matching
source in the same result, so it is reviewed and committed together with the
other changes, and update the documents that describe it. When the task itself
changed a source, bring the local copy to it under the installation
instructions. If the direction is unclear, ask the owner. Do not transfer
`modelRoles.default`, `setupVersion`, secrets, credentials, account data or
other machine-specific values. Pass the comparison result to Smarty as evidence.

## Blind Smarty review

Read [blind-review-cycle](../../../skills/blind-review-cycle/SKILL.md): it is the
shared blind contract. This gate is a standing explicit assignment from the user
for such a cycle; a separate repeated invitation is not required.
Use a fresh `smarty` through `task` with `agent: smarty`, without `model` and
without Main's history: routing sets the model
(GPT parent: gpt-6.1-sol / low; Claude parent: claude-opus-5-5 / low; a parent of another family gets the Claude route).
The reviewer only reads; Main fixes the admitted substantial remarks. Main keeps
responsibility for the final handover and CLEAN.

Pass the original requirements and clarifications, the result's boundaries, the
paths to the real files and the available evidence. Explicitly request a check of
the consistency of the implementation with all documentation relevant to the
result, and of the absence of outdated standing information, junk and conflicts.
Do not pass your own reasoning, earlier remarks or verdicts. Freeze the object
for the duration of the pass without creating copies or service files.
Smarty only reads files; pass content that cannot be read from files, for
example deleted parts, in the assignment.

Before commit or push use `review_stage=pre-action`; before handing over finished
work use `pre-completion`. Follow the shared contract when combining stages: a
CLEAN on the same full result and bases is reused, and there is no repeated review
merely because of the move to commit, push or the final answer. A change of the
result or of the material bases requires a new pass.

For FINDINGS apply the admission rules of the shared contract, fix all admitted
substantial problems as one block and pass the whole updated result to a new
blind Smarty. Continue until one CLEAN; do not add passes for confidence. An
existing ordered blind review can be combined with this gate if it covers the
whole stated object and criteria.

Do not declare the work complete and do not commit or push without CLEAN.
If Smarty is unavailable, the gate is not passed: do not replace it with a
self-check. The check is based on reading and logic. The gate itself does not
require running tests, builds or the application; run them only on a separate
basis. In the final answer briefly report the gate result or the concrete
blocker.
