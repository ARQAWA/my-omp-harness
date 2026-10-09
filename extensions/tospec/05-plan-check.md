# 05. Check of the spec and plan, readiness and launch

Input: the approved spec.md and plan.md.

Run the 05 check of [review](review.md) and fix its findings; when a fix changes
the approved meaning, get it approved through `ask` first. After the CLEAN,
record it and READY FOR IMPLEMENTATION in plan.md.

## Launch

Tell the user in a few lines that the plan is ready: a link to plan.md, what
will be done and how it will end. Call `tospec` with step `ready` and end the
turn with that message; the approval window opens when the turn ends. Do not
read 06. When readiness is lost, return the affected stages, pass the Smarty
check again and call step `ready` again.
