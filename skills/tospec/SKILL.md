---
name: tospec
description: "On explicit /skill:tospec: research the task, agree the spec through ask, prepare a plan checked by Smarty. Execution starts on a reply in ask or a separate +++; Bossy checks the result."
hide: true
---

# ToSpec

One skill with nested steps for any task, including analytical or document work
without a working directory. Preparation produces spec.md and plan.md in the OS
tmp directory. Questions, approval and launch go through the `ask` tool. Step 06
executes the ready plan after launch: the reply «Запустить» in `ask` or a
separate `+++`.

## Basis

Gold Standard and Clear Communication are already in the system prompt from the
extension. Apply Gold Standard to all actions, decisions, documents and
transitions. Choose the simplest sufficient path to the full result: the
produced result stays minimal, the reading is broad. Resolve a material unknown
by the experiment in step 01 when sources are insufficient. Distinguish an
estimate from an observation: do not promise anything measured without a
measurement, nor a global optimum.

## Steps and their loading

Steps are nested instructions, not standalone skills. Read them and the
templates in one batch, without asking whether to continue:

- start: [01](skill://tospec/steps/01-research.md), [02](skill://tospec/steps/02-spec.md),
  [03](skill://tospec/steps/03-approve.md) and the [spec template](skill://tospec/templates/spec.md);
- after the spec is approved: [04](skill://tospec/steps/04-plan.md),
  [05](skill://tospec/steps/05-plan-check.md), [review](skill://tospec/references/review.md)
  and the [plan template](skill://tospec/templates/plan.md);
- after launch: [06](skill://tospec/steps/06-execute.md).

Route: 01 research with questions through `ask` → 02 spec → 03 approval through
`ask` → 04 plan with embedded tasks → 05 spec and plan check by Smarty,
readiness and the launch question → 06 execution and result check by Bossy. This
file is the only copy of the route. Reuse the loaded text; after a context loss
reread what you need. Do not create a loader, cache, extensions or new skills.
When reworking ToSpec, reconcile the whole affected contract: this file, the
steps, references, templates and documentation.

## Questions

Ask every question to the user, and request approval and launch, with the `ask`
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
there are no reviewer chains (the order is in references/review.md). Reviewers
check the task's objects, not the chat style. CLEAN neither replaces approval
nor guarantees freedom from errors. A new result, scope, cost, access, privacy or
a change of an approved condition returns to the spec and its approval.

Documents and research materials live only in the task workspace in OS tmp.
Before launch do not change the target objects: reading, temporary documents and
an isolated experiment under step 01 are allowed. The user's explicit
prohibitions and method are kept. Preparation does not include todo, the goal
and the result check; launch opens step 06 with them. Cleanup follows the
general rules. An active Lunatron keeps its own contract.

Approval, bases, revisions, statuses and checks are kept in two documents,
without a registry, hashes or copies. Readiness requires approval of the current
meaning and a Smarty CLEAN. A substantive amendment or a new decisive fact before
launch removes readiness; which point checks the amendment is in
references/review.md. A version number does not prove currency. Without a user
answer, a needed source or an available reviewer, continue independent work and
wait on the dependent transition.

Launch is the reply «Запустить» to the question of step 05 or a whole user
message `+++`: surrounding whitespace is allowed; a quotation, code or part of a
larger message does not qualify. An answer chosen by ask on timeout
(`auto-selected after timeout`) does not count as launch. Launch refers to the
one unambiguous current ready plan. Do not look for a similar or the latest
workspace; if the link is missing, ask for the exact plan through `ask`. A
repeated launch continues the same execution or reports the result achieved,
without a second todo, a second goal or repeating operations. Readiness alone
does not authorize execution; the materials are kept until it completes.
