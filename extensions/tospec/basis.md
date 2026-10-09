# ToSpec

The `/tospec` mode replaces ordinary planning with spec-driven work for any
task, including analysis or documents without a working directory. The spec
holds exactly what the user asked for, discussed and approved, and the plan and
the result hold exactly what the spec holds: everything agreed is there, and
nothing unagreed is added. The extension keeps the phase, puts the texts of the
current phase into the system prompt and creates the task workspace in the OS
tmp directory; its path is in the header of the ToSpec block.

Phases and calls of the `tospec` tool: **spec** (01 research, 02 spec, 03
approval) → step `plan` after the user accepted the whole spec through `ask` →
**plan** (04 plan with tasks, 05 Smarty check; reasoning is one level lower) →
step `ready` after the Smarty CLEAN and READY FOR IMPLEMENTATION in plan.md,
then end the turn → **ready** (the approval window) → **execute** in a new chat
(06 execution and Bossy check) → step `done` after the Bossy CLEAN, together
with the final report. `/tospec off` switches the mode off. This file is the
only copy of the route; a rework of ToSpec reconciles it with the steps, review,
the templates, the extension and the documentation.

## Questions

Ask every question and request every approval through the `ask` tool, all
questions of one moment in one call. Each question is complete without the chat
and files; options are short, the recommended one carries `recommended`, and
`ask` adds the option for the user's own text itself. Put independent reads in
the same batch and make the dependent transition after the answer. A cancelled
ask, an answer by timeout, a switch to discussion, a question or silence approve
nothing.

## Preparation and launch

During preparation (phases spec, plan and ready) spec.md, plan.md and the
research notes live in the workspace: the extension blocks `write`, `edit` and
`ast_edit` everywhere except the workspace and `local://`, and bash and eval run
only commands that change nothing outside the workspace. Preparation has no
todo, goal or result check; 06 opens them.

After the spec is approved, the agent writes the plan itself without a separate
approval. A new result, scope, cost, access or a change of an approved condition
returns to the spec and its approval. Readiness is the approval of the current
meaning plus a Smarty CLEAN, and a substantive change before launch removes it;
a CLEAN is not an approval.

Only `Launch in a new chat` in the approval window starts execution. The window
shows spec.md and plan.md with a table of contents, chooses the executor model
and reasoning and opens a new clean chat; Esc or `Close` leaves the plan ready,
and `/tospec review` opens the window again. A reply in the chat is an amendment
or a question. A repeated launch continues the same execution without a second
todo or goal and without repeating done operations.
