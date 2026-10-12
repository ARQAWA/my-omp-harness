---
name: repo-audit
description: "Whole-repository consistency audit on the owner's request (audit or аудит), or automatically at the first release after seven days without a clean audit. Bossy checks the current repository and every commit and patch since the audit tag; Main fixes findings until CLEAN."
---

# Repository audit

This is the owner's standing order for [High Review Cycle](../../../skills/high-review-cycle/SKILL.md) with `bossy`. Run on a direct audit request or when [release](../release/SKILL.md) finds the audit due. No background timer or separate service runs while there is no release. Ordinary handover and task-branch stage commits do not start an audit. An audit alone authorizes no merge, push or installation.

## Metadata and schedule

The annotated Git tag `audit` records the last clean, released repository state. Its target identifies the checked `master` commit; its tagger timestamp records when the audit completed, not the age of the underlying commit. Read it with `git for-each-ref --format='%(objectname) %(taggerdate:unix)' refs/tags/audit`, and its target with `git rev-parse audit^{commit}`. Derive the changes counter with `git rev-list --count audit..HEAD`; do not maintain a duplicate counter file.

After fetching the published audit ref, an absent tag, missing audit timestamp, or elapsed time of at least seven days makes the next release due. Never create a marker just to avoid the first audit. Verify that `audit^{commit}` is an ancestor of the result being audited; if not, stop and ask the owner rather than invent a baseline.

## Object and evidence

Work in the task worktree with current `master` incorporated. For a manual audit, use a task branch and worktree if fixes are needed. Main supplies the complete current repository: code, configuration, tests, skills, agents, settings, instructions, `AGENTS.md`, `WORKFLOW-MANIFEST.md`, `WORKING-ENVIRONMENTS.md` and design files. Exclude generated dependencies, build artifacts and other people's unfinished work.

With an existing audit tag, prepare all of the following in the OS temporary directory:

- `git log --reverse --format=fuller audit..HEAD`: every intervening commit and its intent.
- `git log --reverse -p --find-renames audit..HEAD`: every commit's patch, including intermediate changes later reversed or replaced.
- `git diff --find-renames audit..HEAD`: the complete net difference from the last audited state.
- The removed/renamed-path list and any final uncommitted fixes, or commit those fixes on the task branch before refreshing the evidence.

A first audit has no previous audited interval: check the complete current repository and the current task's changes, and explicitly identify this as the baseline audit. Do not pretend a historical audit exists.

## Review

Use `review_stage=pre-action` when the audit gates a release, or `pre-completion` for a standalone audit. The criterion is that current code and all documentation agree with each other and `WORKFLOW-MANIFEST.md`, every change since the last audit is correctly reflected wherever its facts are stated or relied on, and no outdated standing information, junk or conflict remains. Historical commits are evidence, not instructions to restore superseded behavior. Review their effects against the current accepted decisions; remove what was abolished everywhere it still stands. Preserve user data and current decisions, and leave history in Git.

Split the current repository and historical evidence by the size rule of the shared review cycle, keeping code with tests, skills with agents, and settings with installation instructions. Assign every file and every intervening commit patch to a part so none is omitted. Each brief includes its paths and patches, the full commit list and the full removed/renamed-fact list; a part searches for every fact it states or relies on in the other files. Split oversized historical evidence as well, rather than sending every reviewer an unbounded copy of all patches. Run one fresh Bossy per part in parallel. No automatic model change or extra review tier is added.

Main verifies the quotes, fixes all admitted findings in one batch and repeats fresh passes only for parts whose files or dependent facts changed. Untouched parts retain CLEAN. Refresh historical and final-diff evidence after fixes. Stop only when every part is CLEAN; if a repair needs a decision outside the agreement, ask the owner in chat. A clean audit replaces the release diff check for the same result, but not the local settings check or the work-class completion check. The audit adds no tests or trial runs.

## Record the result

For a release audit, retain the clean evidence and actual audit completion time until recording the marker. Do not advance the published marker until the audited result and any fixes have landed in `master` through the normal release. If finalization changes facts the audit checked, refresh the affected parts before recording it.

After the content-equivalent squash merge, set the annotated marker on the new `master` commit with `GIT_COMMITTER_DATE=<audit-completed-at> git tag -f -a audit master -m 'Repository audit CLEAN'`, using the recorded audit completion timestamp, then publish that marker as part of the authorized release with `git push --force-with-lease=refs/tags/audit:<published-oid> origin refs/tags/audit:refs/tags/audit`. Fetch and retain the published tag object ID before replacing it; use an empty expected ID if no published tag exists. The explicit lease protects another agent's audit. A standalone audit reports its result without publishing or moving the shared marker; it does not suspend a later release's schedule based on that marker.

The marker itself is metadata, not a source change requiring a new review. A failed push or any changed object leaves the audit unpublished or invalidated; inspect the actual ref and report the state rather than marking the audit complete by elapsed time.
