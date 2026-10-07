# 03. Approve the spec through ask

Internal communication instruction of ToSpec. Input: the prepared spec, the
decisions D and the bases. Style — [Clear Communication](skill://clear-communication).

## Questions

Get the spec approved with the `ask` tool. Before the call, briefly give in the
chat the problem and the result for the user, the DIRECT and FORCED decisions
with short bases, and for each CHOICE decision the situation, what was done, and
the justification. Do not retell R, AC and F: details are at the link to spec.md.
The chat and the questions must show everything that is being accepted, without
opening the file. Do not pass off the user's direct instructions as your own
ideas.

In one call each CHOICE is a separate question: what is being decided and 2–4
options — the recommended one and the real alternatives, with the consequences in
each description; `recommended` marks the recommended one. Do not invent
alternatives; ask adds the option for the user's own text itself. The last
question is to accept the whole spec, with the options «Принять» (recommended)
and «Есть поправки». Do not ask again about agreed, unchanged content.

## Answers

- A chosen option is the decision for this D; the user's own text is an amendment
  to it.
- «Принять» is approval of the whole meaning with the chosen options. Put a
  choice, text or note that gives an unambiguous new meaning without new
  independent decisions or contradictions into the spec without asking again.
- If an answer creates a new decision, contradiction or ambiguity, or the spec is
  not accepted, make the amendments, design the recommendation for the new
  decision and make a new `ask` call only about the unresolved points and about
  accepting the whole. «Есть поправки» without text — ask about the amendments in
  the chat.

Repeat until the spec is final: all D are decided, the amendments are made, and
the spec is accepted as a whole. A cancelled ask, an answer by timeout
(`auto-selected after timeout`), a switch to discussion, a question or silence do
not approve the spec. Until an answer is received, do not make the dependent
transition.

## Record

Record the questions asked, the revision, the chosen options, the user's exact
texts and the fact that they were taken into account in the "Approval" section of
spec.md; update the statuses of D. Do not invent a locator or approval. Approval
relates to the content, not to the number. Explain your own change of meaning
after approval and get it approved through `ask`. The vN rules are in 02.

Output: approval of the whole current meaning, amendments made, no blocking
questions about the result. Then call `tospec` with step `plan` (it lowers the
reasoning one level for the plan and tasks) and go to 04. There is no separate
plan approval.
