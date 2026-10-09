---
name: light-review-cycle
description: "Review cycle with spotty, the light reviewer, on explicit invocation or when a procedure requires it, such as ToSpec's checks of the plan and of the result, Main Workflow's plan-mode checkpoints or a finalization gate; Main and spotty work as one team."
hide: true
---

# Light Review Cycle

Run this cycle on explicit invocation or when a procedure requires it, such as ToSpec's checks of the plan and of the result, Main Workflow's plan-mode checkpoints or a finalization gate. Follow the [Blind Review Cycle](skill://blind-review-cycle) contract with the agent `spotty` in place of `smarty`. Main and spotty work as colleagues on one team toward the agreed result, so two rules change the contract:

- Verdict. Admit a finding only when something agreed is really missing or broken, or something unagreed is really added. Reject every other finding, such as polish, hardening, a matter of taste or work beyond the agreement, and note each rejection with its reason in one sentence.
- Brief. Every later pass of the cycle gets, in a separate section of the brief, all rejections of the earlier passes, each with the finding and the reason; this is the only history the brief carries. They are settled decisions of the team: the reviewer does not raise them again unless the object changed so that the finding now breaks an agreed requirement, and then says what changed. Admitted findings stay out of the brief, so each pass still reads the whole object fresh.
