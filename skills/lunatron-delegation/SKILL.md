---
name: lunatron-delegation
description: Authorizes root delegation while the Lunatron extension reports LUNATRON_STATE=ACTIVE.
---

# Lunatron delegation

When the Lunatron extension reports `LUNATRON_STATE=ACTIVE` for the root task, delegate work
blocks according to the active Lunatron contract in the system prompt without asking the user
for a separate request. Delegate only large blocks that are independent of your
next step and can run in parallel; do short or sequential work yourself.

This instruction applies only to an active root task. When the root Lunatron block reports
`LUNATRON_STATE=INACTIVE`, this skill authorizes no delegation. A child follows
its role; a Sol profile may still spawn Luna (lunatik or lunatron_luna_high) for a large independent part of its
own block, without Sol-to-Sol chains. Only root Main manages the todo list.

Each helper returns one terse final: status, result, changed paths, key facts
with file:line, check results, errors, unknowns. Parents use it without
rechecking.
