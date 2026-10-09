---
name: blind-review-cycle
description: "Review cycle with smarty on explicit invocation or when a procedure requires it, such as ToSpec, Main Workflow or a finalization gate; the shared contract of High Review Cycle."
hide: true
---

# Blind Review Cycle

Run this cycle on explicit invocation or when a procedure requires it. It uses the agent `smarty`; [High Review Cycle](skill://high-review-cycle) follows this contract with `bossy`.

The reviewer makes one quick surface pass: everything agreed is done, nothing unagreed is added, and the criterion of the check holds. You stay responsible for the result.

1. Object. Without a named object, check the finished result of the current task before reporting completion. Mark the stage: `review_stage=pre-action` for an object that gates a later action, such as a plan, or `review_stage=pre-completion` for a finished result. Keep the object unchanged during a pass.
2. Brief. Launch the reviewer through `task` with `agent` set to its name and no `model`. Give the user's request and amendments in their own words, the agreed decisions, the stage, the paths of the object and its sources, and the criterion this check adds, such as consistency with a named document, between the parts of the result, or with the Gold Standard. Put content that no file holds, such as deleted text, into the brief; leave out your history, reasoning and earlier findings.
3. Verdict. The reviewer returns `CLEAN` or `FINDINGS:` with four fields per finding. A finding is a claim: admit only one that breaks an agreed requirement or the criterion. A pass without admitted findings is CLEAN.
4. Repair. Fix all admitted findings in one batch and launch a fresh reviewer on the whole updated object. Stop at the first CLEAN; add no passes for confidence.

If a reviewer hangs, launch a fresh one on the unchanged object. If the agent cannot start, the check has not passed: tell the user and wait, because no other reviewer or self-check replaces it.
