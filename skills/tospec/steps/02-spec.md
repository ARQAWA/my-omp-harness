# 02. Specification

Write spec.md in the workspace using the [template](skill://tospec/templates/spec.md).
The document is for the agent and has no human-facing part; the explanation for
the user goes in the chat (step 03). Describe the scope and rules for the real
task. Put material observations from an experiment into F with the conditions
and the limit of the conclusion, without a log and without invented runs.

Describe the problem, boundaries, behavior, scenarios, R requirements and AC
acceptance. Each R rests on a U or on a decision D within U; each AC rests on an
R. Examples and exceptions do not introduce hidden behavior. An F confirms a
fact but does not replace the user's assignment.

For each independent design decision record a D and its kind:
- DIRECT — an exact instruction of the user U.
- FORCED — another permissible option violates a standing condition; name it.
  Convenience, habit and a ready-made library do not prove uniqueness.
- CHOICE — there are alternatives; recommend the simplest sufficient option under
  Gold Standard and briefly name the rejected ones and the reasons.

New decisions are only proposed so far. Do not hand the design back to the user:
each CHOICE carries a recommendation and the real alternatives for the question
in 03. A material unknown fact is a Q; ask through `ask` only if research cannot
obtain it.

Detail what the result needs: conditions, data, interfaces, errors, constraints,
verifiable outcomes. Do not add limits, migrations, security, fallback, tests,
infrastructure or rare cases for the sake of quality. Cite an applicable
mandatory contract with its source. Metrics and runs for confidence are not
needed; an experiment — only under 01.

Check the user's conditions and the bases of D while writing; do not reread the
file in a separate pass. For a FORCED decision make sure the alternatives really
violate the condition, otherwise it is a CHOICE.

The first presentation is v1. One user round of substantive amendments raises vN
once; several amendments before the next submission are one round. An internal
fix does not raise the number, but a new meaning or decisive fact removes the
plan's readiness; the old approval is kept only for the unchanged meaning.
Re-checking the amendment is set by review.

Output: a draft with the bases of all R/AC/D, without hidden scope or a work
plan. Next 03; do not launch a reviewer before approval.
