# 02. Specification

Write spec.md in the workspace by the [spec template](spec-template.md). It is a
document for the agent; the explanation for the user goes into the chat in 03.

The spec holds only the original request, its amendments, the user's answers and
the decisions approved in 03. Each requirement R rests on a U or on a decision D
within U, and each acceptance AC rests on an R; examples and exceptions bring in
no hidden behavior, and an F confirms a fact without replacing the user's
assignment. Describe what the result needs: the problem, boundaries, behavior,
conditions, data, interfaces and errors. Add no limits, migrations, security,
fallback, tests or rare cases the user did not ask for.

Record each independent design decision as a D of one kind:
- DIRECT — the user's exact instruction U.
- FORCED — every other option breaks a standing condition; name it. Convenience,
  habit or a ready-made library do not make a decision forced.
- CHOICE — real alternatives exist; recommend the simplest sufficient one and
  name the rejected ones with reasons.

New decisions stay proposals until 03. A material unknown is a Q; ask it through
`ask` only when research cannot obtain it.

The first presentation is v1. One round of user amendments raises vN once; an
internal fix does not raise it, but a new meaning removes the plan's readiness.

Output: a draft where every R, AC and D has its basis, without a work plan. Next
03; launch no reviewer before approval.
