# ToSpec

The `/tospec` mode of this package, for any task including analytical or
document work without a working directory. The extension holds the state
(phase) and the texts of the current phase are already in the system prompt: no
loader is needed. Preparation produces spec.md and plan.md in the task workspace
in the OS tmp directory, created by the extension. Questions and approval of the
spec go through the `ask` tool. Execution runs in a new clean chat started from
the approval window.

Phases and calls of the `tospec` tool: **spec** (steps 01–03) → call `tospec`
with step `plan` after the user accepted the whole spec through `ask` → **plan**
(steps 04–05; reasoning is lowered one level for the plan and tasks) → call
`tospec` with step `ready` after the Smarty CLEAN and the readiness record in
plan.md, then end the turn → **ready** (the approval window) → **execute** in the
new chat (step 06) → call `tospec` with step `done` after the Bossy CLEAN,
together with the final report. `/tospec off` switches the mode off.

## Basis

Gold Standard and Clear Communication are already in the system prompt from the
extension. Apply Gold Standard to all actions, decisions, documents and
transitions. Choose the simplest sufficient path to the full result: the
produced result stays minimal, the reading is broad. Resolve a material unknown
by the experiment in step 01 when sources are insufficient. Distinguish an
estimate from an observation: do not promise anything measured without a
measurement, nor a global optimum.

Route: 01 research with questions through `ask` → 02 spec → 03 approval through
`ask` → 04 plan with embedded tasks → 05 spec and plan check by Smarty and
readiness → 06 execution and result check by Bossy. This file is the only copy of
the route. When reworking ToSpec, reconcile the whole affected contract: this
file, the steps, review, templates, the extension and documentation.

## Questions

Ask every question to the user, and request approval of the spec, with the `ask`
tool. Ask the questions of one moment in one call, in the needed order. Each
question is complete and understandable without the chat and files; options are
short, and the recommended one is marked with `recommended`. `ask` adds the
option for the user's own text itself, so do not add an "Other" option. `ask`
waits for the answer: put independent reads in the same batch, and make the
dependent transition after the answer.

## Authority and readiness

The user approves the whole meaning of the spec through `ask`. After approval the
agent prepares the plan itself, without a separate approval. ToSpec checks two
points: Smarty checks the spec, plan and tasks together before launch; Bossy
checks the execution result. Each point yields one CLEAN and works separately;
there are no reviewer chains (the order is in review.md). Reviewers check the
task's objects, not the chat style. CLEAN neither replaces approval nor
guarantees freedom from errors. A new result, scope, cost, access, privacy or a
change of an approved condition returns to the spec and its approval.

Documents and research materials live only in the task workspace. During
preparation (phases spec, plan, ready) the extension blocks `write`, `edit` and
`ast_edit` outside the workspace and `local://`; bash and eval may run only
commands that change nothing outside the workspace. Reading, temporary documents
and an isolated experiment under step 01 are allowed. The user's explicit
prohibitions and method are kept. Preparation does not include todo, the goal and
the result check; execution opens step 06 with them. Cleanup follows the general
rules.

Approval, bases, revisions, statuses and checks are kept in two documents,
without a registry, hashes or copies. Readiness requires approval of the current
meaning and a Smarty CLEAN. A substantive amendment or a new decisive fact before
launch removes readiness; which point checks the amendment is in review.md. A
version number does not prove currency. Without a user answer, a needed source
or an available reviewer, continue independent work and wait on the dependent
transition.

Launch is only Enter in the approval window. The window shows spec.md and
plan.md with a table of contents and scrolling, selects the executor model and
reasoning and, on `Launch in a new chat`, opens a new clean chat; Esc or `Close`
closes it without launch, and `/tospec review` opens it again. A reply in the chat
is an amendment or a question, not a launch. A repeated launch continues the same
execution or reports the result achieved, without a second todo, a second goal or
repeating operations. Readiness alone does not authorize execution; the
materials are kept until it completes.
