# 05. Spec and plan check, readiness and launch

Input: plan.md and the approved spec.md. Procedure —
[review](skill://tospec/references/review.md), review_stage=pre-completion.

Launch one fresh Smarty under Blind Review Cycle. It checks the spec, plan and
tasks together against the requirements and the full Gold Standard: two-way
reconciliation U → R/D → T → AC, completeness of requirements, preservation of
exact conditions, values, interfaces and constraints; absence of extra work;
order and dependencies; sufficiency of the tasks for an executor without new
design, hidden author knowledge or Main's context; the minimal sufficient
approach, reuse, justification of decisions, absence of unnecessary complexity,
actions and documents, preservation of working behavior. The reviewer does not
reconsider the user's decisions.

The whole result of preparation is checked, not only the diff. Material unknowns,
deferred design and invalid bases of readiness are not allowed. A plan is not
presented as implementation, nor reading a test as running it. Fix findings under
review. If the approved meaning changes, first get it approved through `ask`.

After CLEAN record the fact and READY FOR IMPLEMENTATION in plan.md.

## Launch

Briefly tell the user in the chat that the plan is ready: a link to plan.md, what
will be done and how it will end. Then ask through `ask` «Запустить выполнение?»
with the options «Запустить» (recommended) and «Позже». «Запустить» is the
launch: read 06. For any other answer wait; launch can be given later as a whole
message `+++` (the boundaries are in SKILL.md). Do not run cleanup, and do not
read 06 before launch. If the basis of readiness is lost, return the affected
stages and pass the Smarty check again; do not execute a plan with invalid
approval or CLEAN.
