# ToSpec

The `/tospec` mode replaces ordinary planning with spec-driven work for any
task, including analysis or documents without a working directory. The spec
holds exactly what the user asked for, discussed and approved, and the result
holds exactly what the spec holds: everything agreed is there, and nothing
unagreed is added. The extension keeps the phase, puts the texts of the
current phase into the system prompt and creates the task workspace in the OS
tmp directory; its path is in the header of the ToSpec block.

Phases and calls of the `tospec` tool: **spec** (01 research, 02 spec with
the work class, 03 approval) → step `ready` after the user accepted the whole
spec through `ask`, then end the turn → **ready** (the approval window) →
**execute** in a new chat (04 execution and the result check of the class) →
step `done` after the CLEAN, together with the final report. `/tospec off` switches the mode off. This file is the
only copy of the route; a rework of ToSpec reconciles it with the steps, review,
the templates, the extension and the documentation.

## Questions

Ask every question and request every approval through the `ask` tool, all
questions of one moment in one call. Each question takes one or two sentences,
because the `ask` panel shows only four lines of a question; what the user must
read to answer goes into the chat right before the call, never only into files;
options are short, the recommended one carries `recommended`, and
`ask` adds the option for the user's own text itself. Put independent reads in
the same batch and make the dependent transition after the answer. A cancelled
ask, an answer by timeout, a switch to discussion, a question or silence approve
nothing.

## Preparation and launch

During preparation (phases spec and ready) spec.md and the
research notes live in the workspace: the extension allows file writes
only in the workspace and `local://` (the internal `agent://`, `proc://` and
`xd://` addresses are not files) and blocks `ast_edit` entirely; in bash and
eval run only commands that change nothing outside the workspace.
Preparation has no todo, goal or result check; 04 opens them.

A new result, scope, cost, access or a change of an approved condition returns
to the spec and its approval. Readiness is the approval of the current meaning,
and a substantive change before launch removes it until the user accepts the
spec again.

Only `Launch in a new chat` in the approval window starts execution. The window
shows spec.md with a table of contents, chooses the executor model and
reasoning and opens a new clean chat; Esc or `Close` leaves the spec ready,
and `/tospec review` opens the window again. A reply in the chat is an amendment
or a question. A repeated launch continues the same execution without a second
todo or goal and without repeating done operations.
