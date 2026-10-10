# 04. Execution of the approved spec

Input: the start message of this new chat with the path of spec.md. The
executor model and reasoning were chosen in the approval window.

## Launch

In the first batch read spec.md, the review cycle of its class from
[review](review.md) and call `todo` with op `view`. Check the approval in the
header of spec.md; a missing source or lost readiness stops the dependent work
and returns the affected stage. A repeated launch does not repeat what is done.

Reuse a matching open todo and leave a conflicting one alone; otherwise call
`todo` with op `init` together with the first work calls, with items from the
requirements R and acceptance AC. Set the goal by the goal rule of Main Workflow
from the approved result and acceptance.

## Execution

Carry out every R so that its AC holds. Preserve user changes and mandatory
behavior, and remove what the approved rework makes obsolete within its scope.
Ask questions through `ask` by basis.md; a new result, scope, cost, access or a
change of method returns to approval. The ordinary check is reading and logic.

## Acceptance

After the result, run the 04 check of [review](review.md) and prepare the final
answer while the reviewer works. Fix the admitted findings and repeat with a
fresh reviewer until CLEAN. Separately selected reviews stay, and a mandatory
gate of the environment runs in parallel with this check, each in its own cycle.
If the reviewer cannot start, keep the todo and the goal open, report the
blocker and wait.

## Completion

After the CLEAN, in the final batch close the todo, complete the goal and call
`tospec` with step `done`, then give a short self-contained summary by Clear
Communication: the result, the CLEAN and material limitations.
