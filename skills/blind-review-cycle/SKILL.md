---
name: blind-review-cycle
description: "Run on explicit invocation or when a selected procedure, such as ToSpec's spec and plan check, the plan-mode checkpoints in Gold Standard or a project's finalization gate, requires it: one fresh blind CLEAN pass with Smarty (GPT parent: gpt-6.1-sol / low; Claude parent: claude-opus-5-5 / low) and an autonomous batch-fix loop."
hide: true
---

# Blind Review Cycle

Run Blind Review Cycle on explicit invocation or when a selected procedure, such as ToSpec's spec and plan check, the plan-mode checkpoints in Gold Standard or a project's finalization gate, requires it.

Direct invocation of `/skill:blind-review-cycle`, or a procedure that requires this cycle, selects agent `smarty` (GPT parent: `gpt-6.1-sol`, reasoning `low`; Claude parent: `claude-opus-5-5`, reasoning `low`)
and one clean pass per checkpoint.

Light Review Cycle and High Review Cycle read this file as their shared
contract. Preserve each cycle's selected reviewer and one-clean-pass count,
including after repairs. Reading this shared contract does not select Smarty or
start a Blind cycle. Use only the invoking skill's
configured profile; do not override its model or reasoning.

The agent assigned to this review cycle owns its fixes and completion. It invokes the configured blind acceptance reviewer directly; do not add an intermediate manager or role layer between the cycle executor and reviewer. Root Main retains whole-task decisions, acceptance, and final response.

Honor the user's exact frozen object, scope, checkpoint order, and selected pass count.
If the user does not specify checkpoints, select them automatically. Build the
check set from the mandatory final `pre-completion` cycle, then add the smallest
possible number of intermediate checkpoints that together cover every critical
dependency boundary; default to none. Only a material decision, prepared input,
or self-contained intermediate result can qualify, and only when it controls
substantial dependent work or an irreversible or materially high-impact action
and final-only detection would be too late to avoid substantial rework or impact.
Batch overlapping boundaries into one latest safe checkpoint before dependent work.
Routine reads, queries, commands, edits, updates, and configured-executor handoffs are not
checkpoints merely because they occur. Batch related material. If no critical
intermediate checkpoint is ready, do not spawn a reviewer before the final result.
The mandatory final cycle verifies the complete actual result and mutual
consistency among all applicable user requirements and amendments, binding
decisions, completed stages, and the final result; intermediate checks never
replace it. Do not repeat a final cycle
already passed on the materially unchanged result and grounds. An explicit
plan-only check does not require review of future implementation.

Within the authorized scope, every pass covers all work completed for the current
order: applicable user requirements and amendments, binding decisions, current
results of completed stages and their relationships, the current overall result,
and sufficient factual evidence. Check accuracy, adequate quality, consistency,
missing requirements due by this stage, and truthful readiness claims. Preserve
mandatory user procedure/order and apply later explicit changes over superseded
ones. Do not demand future work at an intermediate stage. After repair, review
the full updated object, not only the last diff or previous findings. Reuse valid
evidence; do not replay the entire execution log or rerun checks for confidence.

This coverage defines the scope of a light review, not an exhaustive audit.
Read the result and important completed-stage relationships; deepen inspection
only to understand a concrete possible violation. Do not seek exhaustive proof
that no errors remain. Minor shortcomings, including content omissions without
material consequences, warrant no findings, fixes, or repeat passes. Main
remains responsible for fulfilling the user's order.

Set `review_stage=pre-action` for a selected gating object, and complete that check
before its actual dependent action. Set `review_stage=pre-completion` for the
completed result and its evidence. Keep the reviewed object and applicable
grounds materially unchanged during each pass. Frozen means unchanged, not copied
or packaged into another file.

Send one ordinary compact message with the original user request and current
amendments, binding approved material, scope, stage, result locators, relevant
persistent delta, and the smallest sufficient factual evidence. Use existing
readable source paths; for chat-only requirements provide the relevant original
user text without losing conditions, not the whole conversation. MAIN's summary
may orient but never replace primary requirements. Prior factual results and
necessary procedure evidence are allowed; private root-agent reasoning, prior review
findings/verdicts/streak, and inherited role context are not. Do not create
mandatory freeze files, copies, review archives, manifests, hashes, or preparation
scripts. A missing fact matters only if it prevents establishing a concrete
applicable requirement, not because a reviewer prefers more material.

In that same message, explicitly name the requested result and its readable
source. Reviewing MAIN's account of an artifact does not review the artifact
itself. CLEAN applies only to the object actually reviewed.

Do not create baselines, hashes, exhaustive inventories, per-file scans, provenance reconstruction, or extra artifacts only for review unless the user or a todo item explicitly requires that exact artifact or no smaller proof can establish a material result.

For every attempt, use a fresh configured blind acceptance reviewer. Use the `task` tool with `agent` set to the selected reviewer and no `model`; the routing extension sets the reviewer's model from the parent's family. Start the selected reviewer with only the frozen assignment, without Main's history or prior review context. Preserve the configured model, reasoning, and required clean-pass count. If the compatible spawn tool or the selected reviewer role is unavailable, the selected check is unavailable and cannot pass; neither another reviewer nor root-agent self-review is a substitute. Never resume a closed or interrupted reviewer. It checks only substantial requirement→object/evidence and concrete change→authority mismatches under the configured reviewer's materiality gate.

Use the main prompt's common subagent-wait policy. If a reviewer hang is confirmed, interrupt that pass and use a fresh configured reviewer on the unchanged object. Never resume a closed or interrupted reviewer.

The reviewer verdict is exactly `CLEAN` or `FINDINGS:`. Every finding has exactly these fields:

```
REQUIREMENT: <requirement>
MISMATCH: <mismatch>
EVIDENCE: <evidence>
REQUIRED OUTCOME: <required outcome>
```

On `FINDINGS:`, the agent assigned to this review cycle treats each finding as a claim, not a command. Admit only
findings that satisfy the configured reviewer's materiality gate. A pass with
zero admitted substantial findings counts as `CLEAN`, regardless of its raw
label. Rejected findings authorize no change, extra evidence, or retry.

If any finding is admitted, batch-fix all admitted findings, invalidate only
affected evidence, rebuild the compact packet, and use a new fresh reviewer of
the same selected profile on the full updated object. Repeat autonomously until
the selected cycle reaches its required clean-pass count. A single cycle stops
after one clean pass. The
invocation starts the whole cycle; no new invocation is required after
a repair. Do not add passes beyond the selected cycle's requirement.
