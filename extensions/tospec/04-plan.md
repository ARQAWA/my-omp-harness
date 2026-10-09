# 04. Plan with tasks

Input: the approved spec. Write plan.md next to spec.md by the [plan
template](plan-template.md); the tasks live inside it.

The plan carries out the approved spec and adds nothing to it. Choose an
existing mechanism or the smallest adaptation, keep mandatory contracts and
working behavior outside the change, and record the important technical
decisions D with their basis, real alternatives and a short reason. D numbers
are unique across both documents; do not repeat the spec's decisions. These
decisions are the agent's own within the approved result; a change of that
result or its conditions returns to 02–03.

Break the work into one sequence of tasks T. Each T names its R, AC or D, the
exact places of change or «create», the action and the check, and anything else
only when the executor cannot do without it. Every R is covered and every T is
necessary. The executor carries out each T without new design or the author's
hidden knowledge; leave local code details to the executor, and do not spell out
lines or retell the spec. The ordinary check is reading and logic; tests, builds
and runs need an explicit basis. The «Execution» field is «not started».

p1 is the first plan. A substantive edit raises pN and, before launch, removes
the Smarty CLEAN and readiness; a status record does not.

Output: a complete plan with status DRAFT. Next 05.
