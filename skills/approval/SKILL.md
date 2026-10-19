---
name: approval
description: "Before work that changes files, code, configuration or settings: decide what the user's words settle, start at once, and ask only about ambiguous wording or your own added decisions."
---

# Approval

Applies to every task that changes files, code, configuration, settings or other state. A question, analysis, plan or one short action does not start it; an accepted `/skill:define-goal` objective replaces it.

Classify the work yourself; the class picks the completion check and never goes into the chat:

| Class | Threshold | Completion check |
|---|---|---|
| micro | point corrections whose meaning is obvious | none |
| small | up to 5 requirements and up to 5 changed files | `review` level light |
| large | more than 5 requirements or more than 5 changed files | `review` level blind |

Apply the micro definition first. Replacing an explicitly specified effort, an existing model or a setting value, together with its required matching mentions, is micro when every correction is mechanical and needs no new decision. Adding a provider, introducing a new model contract or changing behavior is not automatically micro.

Approval step. Before small or large work, read the request as the reviewer will read it at completion. When the user's words let the reviewer confirm the result unambiguously and your way of doing the task adds nothing to them and departs from nothing in them, start at once without an approval message. Ask only about two kinds of places: wording that admits different results, and a decision you made yourself, about the result or the way of doing it, that adds to the user's words or departs from them. Ask about those places only, in the question format of the message rules: your proposal with its reason and the real alternatives, the recommended one marked; then end the turn and wait.

The user's reply starts the work: an answered question takes his choice, an unanswered one the recommended option, and his own text amends the decision; ask again only about what his reply leaves open. Never ask again about what he accepted. No requirement list, work class or separate go question goes into the chat. The agreement is the user's own words, his answers and the proposals he accepted; your unconfirmed interpretation is not part of it. Keep his explicit choices verbatim, and do not turn an unrequested command, format, cap or untouched-file promise into a binding constraint.

Completion check. A task whose only result is an answer or a requested report file, with no change to the project or settings, has none. Before reporting small or large work complete, call `review` at its level with the criterion: the result carries out the user's request as his words, answers and accepted proposals settle it, and adds nothing beyond them. Fix admitted findings and repeat until CLEAN.
