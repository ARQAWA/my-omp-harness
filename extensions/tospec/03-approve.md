# 03. Approval of the spec through ask

Input: the spec draft with its decisions D. Write by [Clear
Communication](skill://clear-communication).

Before the `ask` call, give in the chat the problem and the result, the DIRECT
and FORCED decisions with short bases, and for each CHOICE the situation and the
reason for the recommendation. Leave R, AC and F to the link to spec.md, but
make the chat and the questions show everything being accepted without opening
the file. Do not pass off the user's direct instructions as your own ideas.

In one `ask` call, each CHOICE is a question with 2–4 real options and their
consequences, the recommended one marked; the last question accepts the whole
spec with «Принять» (recommended) and «Есть поправки». Do not ask again about
agreed unchanged content.

- A chosen option decides its D; the user's own text amends it.
- «Принять» approves the whole meaning with the chosen options. Put an answer
  that gives an unambiguous new meaning without new decisions into the spec
  without asking again.
- An answer that brings a new decision, contradiction or ambiguity, or a spec
  that is not accepted, leads to the edits and a new `ask` only about the open
  points and the acceptance of the whole. «Есть поправки» without text: ask
  about the amendments in the chat.

Repeat until every D is decided and the spec is accepted as a whole. Record the
questions, the revision, the chosen options and the user's exact texts in the
«Approval» section of spec.md and update the status of D. Explain your own
change of meaning after approval and get it approved through `ask`.

Output: the whole current meaning is approved. Call `tospec` with step `plan`
and go to 04.
