# Review of preparation and execution

Loaded together with 04–05. ToSpec checks two points; at each there is one fresh
reviewer per pass and one CLEAN:

| Step | Object | Cycle and profile |
|---|---|---|
| 05 | spec, plan and tasks before launch | [Blind Review Cycle](skill://blind-review-cycle), Smarty |
| 06 | execution result | [High Review Cycle](skill://high-review-cycle), Bossy |

The procedure is set by the cycle and its shared blind contract; do not copy the
role and do not redefine the procedure. A reviewer is launched through `task`
with `agent` by name, without `model`:
Smarty (GPT parent: gpt-6.1-sol / low; Claude parent: claude-sonnet-5-5 / high);
Bossy (GPT parent: gpt-6.1-sol / medium; Claude parent: claude-opus-5-5 / low).
Each reviewer checks the object against the requirements — the original request,
amendments, `ask` answers and the spec — and against the full Gold Standard. The
preparation check does not replace acceptance of the result. Separately selected
procedures and environment gates are kept; combine them only when the full
object, profile and criteria match.

## Reviewer bases

Pass the reviewer the paths of spec.md, plan.md and Gold Standard and a short
paragraph: the original request, amendments and `ask` answers, the stage, the
boundaries, vN/pN; for 06 also the list of changed objects and the available
evidence. Do not copy the content of files. Instruct it to read Gold Standard in
full and apply every item. Check minimality with the full result and the
preservation of working behavior outside the change. The reviewer does not check
the user's decisions, future implementation or the chat style; CLEAN is not
approval.

Do not pass Main's history, private reasoning, earlier findings or reports.
Decisions D and the facts of the standing approval are admissible bases. There
are no freeze copies, hashes, archives or reports.

## Findings and fixes

One ToSpec executor runs the checks and the fixes; do not add managers or
independently correcting executors. While a pass is running, do not change the
object. Admit only substantial findings under the shared contract, merge
identical ones and fix the admitted ones as one block in the same turn. A remark
is a claim, not authority: delete anything the reviewer invented on its own, and
do not cut a needed requirement for the sake of CLEAN. Zero admitted findings is
CLEAN.

If a fix changes an approved decision, first get only those decisions approved
through `ask`, then make the edits. A new decision within the approved authority
needs no approval. After an edit, a new fresh reviewer of the same profile checks
the whole updated object without the earlier findings; repeat until CLEAN, there
are no passes for confidence.

Each point works separately and there are no reviewer chains: the edits made for
its findings are rechecked only by a fresh reviewer of that point. Edits made
during the Bossy check and changes made during execution do not return to Smarty:
Bossy reads the whole result anyway. A change of the spec or plan after the
Smarty CLEAN and before launch removes readiness: after approval and the edit, a
fresh Smarty rechecks the spec and plan.

If the profile is unavailable, tell the user and wait; do not substitute another
profile or a self-check for the reviewer. Record CLEAN only after a real pass.
