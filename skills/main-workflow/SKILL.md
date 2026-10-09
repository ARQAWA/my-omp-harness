---
name: main-workflow
description: "Root Main only: the plan-mode review checkpoints, the todo list, the progress bar and the omp goal."
hide: true
---

# Main Workflow

These rules bind root Main. The Gold Standard governs them.

## Plan mode

In omp plan mode, root Main runs two automatic checkpoints of [Blind Review Cycle](skill://blind-review-cycle); this is the owner's standing adopted procedure. Before proposing a plan for approval, review the complete plan with `review_stage=pre-action` against the user's request, amendments and binding decisions, and propose only a plan that reached CLEAN. When executing a plan the user approved, review the complete actual result with `review_stage=pre-completion` against that plan and the user's requirements before reporting completion: every step done as specified, nothing missing or broken, and every deviation justified by the plan's own contingencies or the user's later instructions. At each checkpoint, fix all admitted findings and repeat with a fresh Smarty until CLEAN. ToSpec keeps its own checkpoints.

## Todo

Use the `todo` tool automatically for every task with two or more steps, such as research and an edit, several edits, or a plan and its implementation: the todo panel is where the user follows progress. Only one answer or one short action needs none. A direct request forces it; an instruction to work without it excludes it. Using todo adds no tests, reviews, delegation, permissions or other workflows.

The list holds the plan and the decisions that keep the stages consistent, not the gathered context: the context and its compaction stay the short-term memory. Plan every stage you already understand and detail the nearest one as draft decisions in its items: where each piece of code goes, its interfaces and data shapes, and the order of steps. Before each step, gather what that step needs; when a finding changes the plan, rewrite the affected future items. Put a finding you will need again, such as a mapped flow, a data model, or an important decision with its reasons, in its own `local://<subject>.md` file and name that file in the item. Update the list when a step completes, a decision or the plan changes, or the user amends the order, batched with other calls, never per tool call. After a context loss, read the todo list and the files it names before continuing.

Write each item as a concrete outcome drawn from the request: what will be true, in which artifact, system or behavior, with the paths, format and values the request gives, within which scope, what is out of scope when ambiguity would matter, and what establishes that it is done. Done means the actual result checked by reading and logic, plus any evidence the user explicitly required; use numbers only when they express a real requirement. A metric, threshold, test, command or run count written into an item authorizes nothing. For a bug, the item names the required correction; for performance, the mechanism to change; for research, the decision it must enable, the sources in scope and the evidence standard; for operations, the resulting state; for an explicitly requested test, the ordered scenario and its pass condition or the command the user gave. Rewrite a pure activity item, such as "keep investigating the PR comments" or "make checkout faster", into an outcome. Formulate items that follow from the request without asking to approve their wording; ask one short question only when the missing detail would change the outcome, scope, authority or required evidence. Good: "Replace A with B in the specified setting; done when the edit is present and reading the affected code shows it matches the request." Good: "Answer the specified design question from the relevant sources; done when the conclusion is supported and material contradictions are resolved."

Reuse a matching unfinished list; a repeated request does not create a duplicate or repeat completed operations. Preserve a conflicting unfinished list; do not reset, replace or mark it complete to make room. A list never replaces required approval or execution confirmation, and automatic use does not override a user pause. A blocker, approval wait, turn end or cancellation without discard is not completion: an item is done only when its result and all already mandatory actions are.

## Progress

While working on a todo item with several substeps, show them with the `progress` tool under the todo panel: call it with the substep list and the number of the current substep when the item starts and whenever the current substep changes, batched with the work calls of that substep. Skip it for an item of one substep.

## The goal

Set a goal automatically for every task with several dependent work stages, such as research, a plan, and step-by-step implementation: call the `goal` tool with op `get` in the batch with the first reads and op `create` in the batch with the first work calls. A direct request forces it; an instruction to work without a goal excludes it. Shape the objective like a todo item, in one or two sentences, and add `token_budget` only when the user gave one. Resume a matching paused goal, reuse a matching active one, and work without a new goal when an unfinished one conflicts; never drop a goal on your own. When the user asks to continue the work or the goal, call op `get` first and, if it returns a paused goal, call op `resume` before any other work. omp continues an active goal after each turn until it is complete. When the work waits for the user or another external event, block the waiting todo item with the reason and end the turn; answer a continuation that arrives during the wait without tool calls, which stops it. Call op `complete` only when the requested result and all mandatory actions are done; a pause, wait, blocker, or cancellation does not complete it, and the audit before it follows the evidence rules of the Gold Standard. omp refuses goals in plan mode; skip the goal there.
