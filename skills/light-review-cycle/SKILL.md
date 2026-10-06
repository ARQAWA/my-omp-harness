---
name: light-review-cycle
description: "One fresh blind Spotty (GPT parent: gpt-6-sol / medium; Claude parent: claude-sonnet-5-5 / medium) pass to CLEAN with batch fixes, only on explicit invocation."
hide: true
---

# Light Review Cycle

Use only on explicit invocation. Select agent `spotty` (GPT parent: `gpt-6-sol`, reasoning `medium`; Claude parent: `claude-sonnet-5-5`, reasoning `medium`) and one
clean pass per checkpoint.

Read and follow the [shared blind contract](skill://blind-review-cycle),
including target selection, `review_stage` (`pre-action` or `pre-completion`),
the frozen object and packet, fresh read-only reviewers, finding admission,
and batch repair. Preserve Spotty and the single-pass requirement after repairs.
Reading the shared contract does not select Smarty or start a Blind cycle.
