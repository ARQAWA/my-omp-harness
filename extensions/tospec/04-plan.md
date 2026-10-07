# 04. Plan with embedded tasks

Input: the approved spec. Create plan.md next to spec.md using the
[plan template](plan-template.md); there is no separate tasks.md.

Choose an existing sufficient mechanism or a minimal adaptation under Gold
Standard. Assess efficiency theoretically; resolve a material unknown under 01,
without repeats for confidence. Preserve mandatory contracts and working
behavior outside the change.

Record the approach and the important technical decisions D: basis, impact, real
alternatives, a short reason. D numbers are unique across both documents; do not
duplicate the spec's decisions. These are the agent's decisions within its
authority and need no separate user approval. A change to the approved result or
conditions returns to 02–03.

## Tasks

Break the work into one sequence of T without a P list. For each give R/AC/D, the
scope (exact points of change, a reference to a model, or "create"), the action
and the check; add anything else only if the executor cannot manage without it. A
T with no link to R/AC/D is invalid. All R are covered, and each T is necessary.

Sufficiency: the executor carries out a block without new design, hidden author
knowledge or an unresolved choice. The author of the plan makes the important
decisions; local code details are left to the executor. Do not spell out lines,
do not retell the sources or the spec, do not split what is simple. The number of
tasks is not fixed. Resolve a material uncertainty by reading and deciding, or
name a blocker. Executors are chosen by external rules; the plan does not enable
delegation.

Reading and logic are the ordinary check. Specify tests, builds and runs only
when an explicit basis is in force. Preparation allows only the isolated research
under 01. Add nothing "while at it". The "Execution" field is "not started".

## Version and output

p1 is a new plan. A substantive edit of the plan raises pN and, before launch,
removes the Smarty CLEAN and readiness; a service record of status or CLEAN does
not change the version. An unchanged spec needs no re-approval.

Output: a complete feasible plan, status DRAFT until checked. Next 05, without
approval.
