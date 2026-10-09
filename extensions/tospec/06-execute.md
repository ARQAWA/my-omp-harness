# 06. Execution of the approved plan

Input: the start message of this new chat with the paths of spec.md and plan.md.
The executor model and reasoning were chosen in the approval window.

## Launch

In the first batch read spec.md, plan.md and [Light Review
Cycle](skill://light-review-cycle) and call `todo` with op `view`. Check the
approval and the Spotty CLEAN in their headers; a missing source or lost
readiness stops the dependent work and returns the affected stage. A repeated
launch does not repeat what is done.

Reuse a matching open todo and leave a conflicting one alone; otherwise call
`todo` with op `init` together with the first work calls, with items from the
approved result and acceptance and without copying the plan. Set the goal by the
goal rule of Main Workflow from the approved result and acceptance.

## Execution

Carry out the tasks T in order. Preserve user changes and mandatory behavior,
and remove what the approved rework makes obsolete within its scope. Ask
questions through `ask` by basis.md; a new result, scope, cost, access or a
change of method returns to approval, and changed tasks need an updated plan.
The ordinary check is reading and logic. Update the «Execution» field of plan.md
once, at completion or pause.

## Acceptance

After the result, run the 06 check of [review](review.md) and prepare the final
answer while Spotty works. Fix the admitted findings and repeat with a fresh
Spotty until CLEAN. Separately selected reviews and mandatory gates of the
environment stay; combine them when the object and criterion match. If Spotty
cannot start, keep the todo and the goal open, report the blocker and wait.

## Completion

After the CLEAN, update «Execution». In the final batch close the todo,
complete the goal and call `tospec` with step `done`, then give a short
self-contained summary by Clear Communication: the result, the CLEAN and
material limitations.
