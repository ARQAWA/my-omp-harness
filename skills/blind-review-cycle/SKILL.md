---
name: blind-review-cycle
description: "Review cycle with smarty on explicit invocation or for the completion check of large work; the shared contract of Light Review Cycle (spotty) and High Review Cycle (bossy): Main and the reviewer work as one team for the user's agreement, and every finding and rejection rests on verbatim quotes."
hide: true
---

# Blind Review Cycle

Run this cycle with the agent `smarty` on explicit invocation or when a procedure requires it, such as the completion check of large work in [Main Workflow](skill://main-workflow) or in ToSpec. Its contract is shared: [Light Review Cycle](skill://light-review-cycle) follows it with `spotty` and [High Review Cycle](skill://high-review-cycle) with `bossy`.

The reviewer goes through the whole object once and returns every finding of that pass at once: everything agreed is done, nothing unagreed is added, and the criterion of the check holds. Every pass is blind and complete, like the first one: a reviewer can miss a problem that the next fresh pass catches. You stay responsible for the result.

Main and the reviewer work as one team for the user's agreement, not for each other's convenience. The agreement is the user's own words and the requirements the user confirmed, including the approved spec in ToSpec. Findings and rejections rest on verbatim quotes, so a dispute is settled by comparing text, without a third party.

1. Object. Without a named object, check the finished result of the current task before reporting completion. Mark the stage: `review_stage=pre-action` for an object that gates a later action, such as a plan, or `review_stage=pre-completion` for a finished result. Keep the object unchanged during a pass. When the object with the sources it relies on is larger than about 200 KB of text (about 50 000 tokens), split it by paths into parts of at most that size, keeping related files together, so that no file is left out, and give every part to its own reviewer in one `task` call. Each reviewer then stays well below its compaction threshold, and the check takes the time of one part.
2. Brief. Launch the reviewer through `task` with `agent` set to its name and no `model`. Give the user's request, amendments and confirmed requirements verbatim, never retold, the agreed decisions, the stage, the paths of the object and its sources, and the criterion this check adds, such as consistency with a named document, between the parts of the result, or with the Gold Standard. Put content that no file holds, such as deleted text, into the brief. From the second pass on, add a separate section with every finding rejected in earlier passes and its reason; leave out your history, reasoning and admitted findings, so each pass reads the whole object fresh.
3. Verdict. The reviewer returns `CLEAN` or `FINDINGS:` with numbered findings (`FINDING 1`, `FINDING 2`, …), one discrepancy each, in four fields: REQUIREMENT quotes the agreement verbatim with its source, or says `NOT AGREED` for an element the work added or changed; EVIDENCE quotes the object verbatim with its file path and no line number; find the place by searching for the quote. After either verdict, an optional `UNCHECKED:` section lists, one per line, a path or requirement the reviewer could not check and the reason. Check the quotes against their sources and decide by text alone:
   - A finding whose quotes stand verbatim in their sources is admitted, and you fix it; you may not reject it.
   - A finding without a verbatim quote of the agreement, or whose evidence is not in the object, is rejected with the reason «no quote».
   - A `NOT AGREED` finding is rejected only by a verbatim quote of the agreement that covers the added element.

   Write every rejection with its reason in one sentence, including the quote it rests on. A pass without admitted findings is CLEAN.
4. Repair. Fix all admitted findings in one batch and launch a fresh reviewer with the same brief, plus the rejections, on the whole updated object, as for the first pass. With parts, launch fresh reviewers on every part the fixes touch: a part that had findings, whose files changed, or that states or relies on a fact a fix changed. An untouched part keeps its CLEAN. Stop when every part is CLEAN; add no passes for confidence.

If a reviewer hangs, launch a fresh one on the unchanged object. If the agent cannot start, the check has not passed: tell the user and wait, because no other reviewer or self-check replaces it.
