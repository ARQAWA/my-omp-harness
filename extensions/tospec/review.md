# Review in ToSpec

| Step | Object and stage | Cycle | Criterion |
|---|---|---|---|
| 05 | spec, plan and tasks before launch, `review_stage=pre-action` | [Light Review Cycle](skill://light-review-cycle), Spotty | the spec holds everything the user asked for and approved and nothing else; the tasks carry out every R and AC and add nothing, in an order an executor follows without new design |
| 06 | the execution result, `review_stage=pre-completion` | [High Review Cycle](skill://high-review-cycle), Bossy | the result does everything the approved spec and plan require and nothing they do not |

Brief: the user's request, amendments and `ask` answers in their own words; the
paths of spec.md and plan.md, and for 06 the changed objects; the stage and the
criterion of the row; the decisions D and the «Approval» section of spec.md as
the agreed decisions, which the reviewer does not reconsider.

When a fix changes an approved decision, get only that decision approved through
`ask` before the edit.

Changes made during execution do not return to Spotty, because Bossy reads the
whole result; a change of the spec or plan after the Spotty CLEAN and before
launch removes readiness until a fresh Spotty checks them again.
