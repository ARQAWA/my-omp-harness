# Guided goal

The user started `/guided-goal`. Their message after `Guided goal:` is the rough objective: a description of the task, not yet an order to act. If there is none, ask what they want to achieve. Agree on one goal with the user, set it with the `goal` tool, carry it out, and finish only after a blind reviewer returns CLEAN. A goal runs across many turns and outlives context compaction, and omp repeats its objective in every goal turn, so the objective alone must carry everything the work and its review need, including the user's own words.

## 1. Explore first

Before the first question, read the code, configuration and documents the rough objective touches, read-only and only as far as the questions need. Ask nothing the files answer, and ground every question and the draft in the project's actual stack, conventions and checks.

## 2. Interview

Ask through `ask` and put all open questions of a round into one call. Each question is one or two sentences and offers two to four concrete options from the project, the recommended one first. Ask only what changes the result and what the files cannot settle: the end state, how to prove it, what must not change, the limits of the run, and the hard parts the user may not have weighed, such as edge cases and tradeoffs. Stop once the objective below can be written; one or two rounds usually suffice. If the user declines or abandons the interview, set no goal.

## 3. Draft the objective

Write the objective in the user's language, with these sections in this order:

- `## Objective`: one or two sentences naming the single measurable end state.
- `## Quotes`: numbered verbatim quotes of the user, `Q1. «…» (source)`. Take every statement of a requirement, value, constraint or prohibition from the rough objective, the user's messages and their `ask` answers. Copy each one character for character, without retelling, correcting or merging. Keep it short and clear on its own; when it makes sense only together with its question, such as a picked option or a «да», name that question as the source. These quotes are the agreement the reviewer enforces: with them it proves to Main that agreed work is missing or done badly, or that work nobody agreed to was added.
- `## Success criteria`: `S1. <one result>. Check: <command, or file to read> → <expected signal>. Quotes: Q2, Q4.` Each criterion is binary: a reader who sees only the evidence decides pass or fail without taste, so reject «works well», «clean» or «done». Use the project's existing checks; when no command proves a criterion, reading the named file is its check.
- `## Boundaries`: what may change and what must stay unchanged (files, interfaces, data, operations), each line with its quotes.
- `## Stop conditions`: the attempt cap in turns or tries, and when to stop and ask the user: ambiguity the agreement does not settle, a risky or irreversible operation, the cap reached. Each line with its quotes.
- `## Review`: the class and the completion rule, from the template below.

An item the user did not say, such as a check or a cap you propose, carries `Quotes: proposed`; it binds once the user accepts the retelling that names it.

Review template; the class follows the work-class table of Main Workflow, small for up to 5 requirements and up to 5 changed files and large for more, where each success criterion counts as one requirement:

    ## Review
    Class: <small | large>. Before `goal` op `complete`, run every Check once and save the outputs to a `local://` file. Then run <[Light Review Cycle](skill://light-review-cycle) for small | [Blind Review Cycle](skill://blind-review-cycle) for large> with `review_stage=pre-completion`: the agreement is the Quotes, Success criteria, Boundaries and Stop conditions of this objective, verbatim; the object is the changed files and the check outputs; the criterion is that every success criterion holds by its check, every boundary holds, and nothing outside the agreement was added. When the repository's instructions add a mandatory gate, run it in parallel, each in its own cycle. Fix every admitted finding and repeat until every cycle returns CLEAN. Complete the goal only after CLEAN.

## 4. Confirm

The objective is for the agent and the reviewer; never show it to the user. First check it against the user's words: every agreed requirement, value, constraint and prohibition is in it, nothing is lost or distorted, and nothing the user did not say is added except items marked `Quotes: proposed`. You may run [Light Review Cycle](skill://light-review-cycle) with `review_stage=pre-action` for this check.

Then write in the chat a short retelling in the user's language: numbered items of one line each with the exact values the user accepts, including every proposed item, then the sections «Границы», «Остановка» and «Проверка», a line or two each. Call `ask` with a one-sentence question such as «Принять цель выше?» and the options «Принять» (recommended) and «Поправить»; the `ask` panel shows only four lines of a question, so the retelling stays in the chat. A correction changes the objective and adds the user's new words to Quotes; check it again, show the new retelling and ask again. Acceptance of the retelling accepts the objective and replaces the requirement step of Main Workflow.

## 5. Set and work

Call `goal` with op `create`, the accepted objective verbatim, and `token_budget` only when the user gave one. Confirm in one sentence and start. Work by the objective and Main Workflow, and show evidence instead of claiming success: the command and what it returned, the file and what it now says. When a stop condition fires, report it and wait for the user as Main Workflow describes, with the goal left open.

## 6. Finish

Follow the objective's Review section, then complete the goal and report the result with the evidence for each criterion. If the reviewer cannot start, leave the goal open, tell the user and wait.
