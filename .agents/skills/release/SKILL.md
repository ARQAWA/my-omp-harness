---
name: release
description: Release, commit, push, sync or install my-omp-harness; release uses valid settings evidence, one combined task/documentation review and a due Bossy audit after ordinary repairs, then squash merge, push and installation of the changed parts; ordinary handover and stage commits do not trigger release.
---

# Release

The words release, commit, push and sync («релиз», «коммит», «пуш»,
«синхронизация» and their verb forms) each order one full release of this
repository as one package: the settings sync, every check and the
finalize-work gate, the merge of the task branch into `master`, push,
installation on the current host and removal of the task's branch and
worktree. Merge and push require valid CLEAN coverage for local settings,
release documentation and any required work-class review; a clean repository
audit can cover only the documentation criterion. They never run without the
rest of the package. The stage commits that `AGENTS.md`
requires during the work go to the task branch and are not a release.
«Установить» or «обновить» without them order installation only, by
[INSTALL_FOR_AGENTS.md](../../../INSTALL_FOR_AGENTS.md), without a merge or a
push. herdr and omp-vscode are released only when their sources changed or
the owner names them.
Every release accounts for the whole package, reusing completed steps whose
checked inputs and grounds still match. A changed unrelated file or commit ID
does not invalidate other checks. Main hands every program run below (tests,
the VSIX build, checks of the changed parts) to `shell_runner` and keeps only git,
`gh`, `cp`, `omp config` and `eval` in its own calls.

`<task>` is the task branch, `<worktree>` its worktree, and `<clone>` the main
clone on `master`, which is the installed copy.

1. In `<worktree>`, commit every remaining change of the task to `<task>` with
   `git add` of its exact paths, without other people's changes. If `master`
   has moved since the branch started, merge `master` into `<task>` and resolve
   the conflicts there, so that the checks and the gate see the result that
   will land.
2. Fetch the published `audit` tag if present and retain its object ID for
   the later explicit push lease; an unpublished local tag is not proof of a
   previous shared audit. Read its tagger timestamp and changes counter by
   [repo-audit](../repo-audit/SKILL.md). When the tag is absent, has no audit
   timestamp, or is at least seven days old, schedule the Bossy audit after
   ordinary work and its admitted findings are settled in step 3.
3. Obtain the existing `node tests/run.mjs` result for the affected inputs:
   run once if no valid result exists for the changed code, configuration or
   document contracts it tests. Reuse it for unchanged tested inputs; do not
   rerun for staging, squash or unrelated prose edits. Fix a revealed failure
   and rerun its check; changed tested inputs require updated evidence.
   Apply [finalize-work](../finalize-work/SKILL.md): compare current settings
   with the recorded actual Spotty CLEAN and launch Spotty only if its inputs
   or grounds changed or evidence is missing. For small/large work, cover
   requirements and release documentation in one class-review pass; retain
   unchanged coverage already obtained. For micro or missing documentation
   coverage alone, run the diff-only Spotty unless the due audit will cover it.
   Run independent checks in parallel on a frozen result. Main fixes all
   admitted findings in one batch and repeats only affected checks or parts.
   After ordinary repairs are settled, run the scheduled Bossy audit on that
   prepared result, repair its findings until CLEAN and update only the prior
   checks whose inputs those repairs changed. Commit fixes to `<task>`.
4. In `<clone>`: squash merge only, never a plain merge: `git merge --squash
   <task>`, then `git commit` with a message that sums up the task, then
   `git push origin master`.
5. If this release ran a CLEAN audit, move and publish its annotated `audit`
   tag on the new `master` commit by repo-audit's recording procedure.
   Otherwise leave the marker unchanged. A rejected tag lease is a blocker:
   read the published state rather than overwriting another audit.
6. Install on the current host: `omp config get extensions --json` must list
   `<clone>`. If `SYSTEM.md` changed, copy it by
   [system-prompt.md](../../../install-instructions/system-prompt.md); if the
   requirements changed, such as `modelRoles`, apply them by
   [harness.md](../../../install-instructions/harness.md), and changed owner
   settings by [omp.md](../../../install-instructions/omp.md). Reuse installed
   dependencies and unchanged installation evidence; run only affected checks
   from the selected instructions. Do not update unrelated components or
   rerun the full first-installation check. Ask the owner to start a new omp
   session.
7. In `<clone>`: `git worktree remove <worktree>` and `git branch -D <task>`
   (after a squash merge git does not count the branch as merged).

## herdr

The sources are the private fork `ARQAWA/herdr`; the ready files are the
`herdr` release of this repository. Only the manual workflow
`build-artifacts-manual.yml` builds them, for all systems with `ReleaseFast`
and SIMD, in about 10 minutes. Commit and push to `master` of `ARQAWA/herdr`,
then build and replace the release files:

```bash
RUN="$(gh workflow run build-artifacts-manual.yml -R ARQAWA/herdr | grep -o '[0-9]*$')"
gh run watch "$RUN" -R ARQAWA/herdr --exit-status
D="$(mktemp -d)" && gh run download "$RUN" -R ARQAWA/herdr -D "$D" && gh release upload herdr -R ARQAWA/my-omp-harness --clobber "$D"/*/herdr-* && gh release edit herdr -R ARQAWA/my-omp-harness --notes "ARQAWA/herdr $(gh run view "$RUN" -R ARQAWA/herdr --json headSha -q .headSha)"
```

Then update herdr on the current host by
[herdr.md](../../../install-instructions/herdr.md).

## omp-vscode

The VSIX packs `omp-vscode/` with the latest `omp-windows-x64.exe` of
`can1357/oh-my-pi` as `bin/omp.exe` and replaces the file of the `omp-vscode`
release; `shell_runner` runs the `npx` build step of this chain:

```bash
D="$(mktemp -d)" && TAG="$(gh release view -R can1357/oh-my-pi --json tagName -q .tagName)" && cp omp-vscode/package.json omp-vscode/extension.js "$D" && gh release download "$TAG" -R can1357/oh-my-pi -p omp-windows-x64.exe -D "$D/bin" && mv "$D/bin/omp-windows-x64.exe" "$D/bin/omp.exe" && (cd "$D" && yes | npx --yes @vscode/vsce package --no-dependencies --target win32-x64 -o omp-vscode.vsix) && (gh release view omp-vscode -R ARQAWA/my-omp-harness >/dev/null 2>&1 || gh release create omp-vscode -R ARQAWA/my-omp-harness --title omp-vscode --notes "omp $TAG") && gh release upload omp-vscode -R ARQAWA/my-omp-harness --clobber "$D/omp-vscode.vsix" && gh release edit omp-vscode -R ARQAWA/my-omp-harness --notes "omp $TAG"
```

## Errors

When a push, build, upload or installation is uncertain, read the state first
(`git status`, `git log -1 origin/master`, `git worktree list`, `gh run list`,
`gh release view herdr`, `gh release view omp-vscode`, `omp config get …`) instead of repeating blindly,
report the unfinished stage and do not declare the release complete.
