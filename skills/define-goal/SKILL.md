---
name: define-goal
description: "Agree on one goal with the user, set it with the goal tool, carry it out and finish only after review returns CLEAN. Started by the user with /skill:define-goal."
disable-model-invocation: true
---

# Define goal

The user started `/skill:define-goal`. The text after it is the rough objective: a description of the task, not yet an order to act. If there is none, ask what they want to achieve. Agree on one goal with the user, set it with the `goal` tool, carry it out, and finish only after `review` returns CLEAN. A goal runs across many turns and outlives context compaction, and omp repeats its objective in every goal turn, so the objective alone must carry everything the work and its review need, including the user's own words.

Write every message by the message rules. The user never sees the objective and does not keep earlier messages in mind, so name every item, quote, criterion, option and file by what it says, never by a code or a bare number.

## 1. Explore first

Before the first question, read the code, configuration and documents the rough objective touches, read-only and only as far as the questions need. Ask nothing the files answer.

## 2. Interview

Ask in the chat, in the question format, all open questions of a round in one message, then end the turn and wait. Ask only what changes the result and what the files cannot settle: the end state, how to prove it, what must not change, the limits of the run, and hard parts the user may not have weighed. Each question gives two to four concrete options from the project, the recommended one marked, each with its consequence. Stop once the objective can be written; one or two rounds usually suffice. If the user declines, set no goal.

## 3. Draft the objective

Write it in English, keeping the user's quotes verbatim in his language, with these sections in order:

- `## Objective`: one or two sentences naming the single measurable end state.
- `## Quotes`: numbered verbatim quotes, `Q1. «…» (source)`: every requirement, value, constraint or prohibition from the rough objective, the user's messages and answers, copied character for character. When a quote makes sense only with its question, such as a picked option or a «да», name that question as the source.
- `## Success criteria`: `S1. <one result>. Check: <command, or file to read> → <expected signal>. Quotes: Q2, Q4.` Each criterion is binary; reject «works well» or «clean». Use the project's existing checks; when no command proves a criterion, reading the named file is its check.
- `## Boundaries`: what may change and what must stay unchanged, each line with its quotes.
- `## Stop conditions`: when to stop and ask: ambiguity the agreement does not settle, a risky or irreversible operation, or a cap the user gave. Do not invent a cap.
- `## Review`: `Class: <small | large>` (small: up to 5 success criteria and up to 5 changed files; large: more), then: "Before `goal` op `complete`, obtain each Check result once and save the outputs to a `local://` file. Then call `review` at level <light for small | blind for large> with the Quotes, Success criteria, Boundaries and Stop conditions verbatim as the agreement, the changed files and check outputs as the object, and the criterion that every success criterion holds by its check, every boundary holds and nothing outside the agreement was added. Fix admitted findings and repeat only affected checks until CLEAN. Complete the goal only after CLEAN."

Keep required outcomes distinct from implementation choices. A necessary constraint the user did not state carries `Quotes: proposed` and binds only after the user accepts it.

## 4. Confirm

Check the objective against the user's words: nothing agreed is lost or distorted, nothing unsaid is added except `Quotes: proposed` items. Never show the objective. Write a short retelling in the user's language: one bold sentence with the main point, short numbered items with the exact values, then «Границы», «Остановка» and «Проверка», a line or two each. Mark every proposed item as your proposal with its reason.

When the retelling holds no proposal, divergence or decision of yours the user must confirm, set the goal at once by step 5. Otherwise put each into the question format and end with one line that says what starts and asks for the go, such as «Начинаем цель: интерфейс в стиле Cursor? Ответь «го» или напиши, что поправить.» Then wait. «го», «да» or «начинаем» accepts the whole goal with the chosen options, the recommended ones where unanswered. A correction changes the objective and adds his words to Quotes; show the new retelling and ask again only about what changed.

## 5. Set and work

Call `goal` with op `create`, the fixed objective verbatim, and `token_budget` only when the user gave one. Confirm in one sentence and start. Claim success only from evidence. When a stop condition fires, report it and wait with the goal left open.

## 6. Finish

Follow the objective's Review section, then complete the goal and report briefly what is now true and whether every check passed. If `review` cannot start, leave the goal open, tell the user and wait.
