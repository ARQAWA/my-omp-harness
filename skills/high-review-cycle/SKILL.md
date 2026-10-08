---
name: high-review-cycle
description: "Run on explicit invocation or when a selected procedure, such as ToSpec's result check, requires it: one fresh blind CLEAN pass with Bossy (GPT parent: gpt-6.1-sol / medium; Claude parent: claude-opus-5-5 / medium) and an autonomous batch-fix loop."
hide: true
---

# High Review Cycle

Run on explicit invocation or when a selected procedure, such as ToSpec's result check, requires it. Select agent `bossy` (GPT parent: `gpt-6.1-sol`, reasoning `medium`; Claude parent: `claude-opus-5-5`, reasoning `medium`) and one clean pass per checkpoint.

Read and follow the [shared blind contract](skill://blind-review-cycle),
including target selection, `review_stage` (`pre-action` or `pre-completion`),
the frozen object and packet, fresh read-only reviewers, finding admission,
and batch repair. Preserve Bossy and the single-pass requirement after repairs.
Reading the shared contract does not select Smarty or start a Blind cycle.
