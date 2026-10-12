---
name: release
description: Release, commit, push, sync or install my-omp-harness; release, commit, push and sync each order one full release as one package (settings sync, all checks and the finalize-work gate under spotty's control, the merge of the task branch into master, push, installation on the current host, removal of the task branch and worktree); ordinary edits and stage commits to a task branch do not trigger release.
---

# Release

The words release, commit, push and sync («релиз», «коммит», «пуш»,
«синхронизация» and their verb forms) each order one full release of this
repository as one package: the settings sync, every check and the
finalize-work gate, the merge of the task branch into `master`, push,
installation on the current host and removal of the task's branch and
worktree. Spotty controls the package: without its CLEAN on the whole
repository there is no merge into `master` or push, and a merge or push never
runs without the rest of the package. The stage commits that `AGENTS.md`
requires during the work go to the task branch and are not a release.
«Установить» or «обновить» without them order installation only, by
[INSTALL_FOR_AGENTS.md](../../../INSTALL_FOR_AGENTS.md), without a merge or a
push. herdr, omp-vscode and lcm are released only when their sources changed or
the owner names them.
Every release runs the whole package; a step counts as done only while its
result still holds, such as a test run or a gate CLEAN after which no file
changed. Main hands every program run below (tests,
the VSIX build, checks of the changed parts) to `shell_runner` and keeps only git,
`gh`, `cp`, `omp config` and `eval` in its own calls.

`<task>` is the task branch, `<worktree>` its worktree, and `<clone>` the main
clone on `master`, which is the installed copy.

1. In `<worktree>`, commit every remaining change of the task to `<task>` with
   `git add` of its exact paths, without other people's changes. If `master`
   has moved since the branch started, merge `master` into `<task>` and resolve
   the conflicts there, so that the checks and the gate see the result that
   will land.
2. If files changed after the last run of `node tests/run.mjs`, run it once in
   `<worktree>`. Then run [finalize-work](../finalize-work/SKILL.md) with
   `review_stage=pre-action` on the whole repository in `<worktree>` until
   CLEAN, and commit its fixes to `<task>`.
3. In `<clone>`: squash merge only, never a plain merge: `git merge --squash
   <task>`, then `git commit` with a message that sums up the task, then
   `git push origin master`.
4. Install on the current host: `omp config get extensions --json` must list
   `<clone>`. If `SYSTEM.md` changed, copy it by
   [system-prompt.md](../../../install-instructions/system-prompt.md); if the
   requirements changed, such as `modelRoles`, apply them by
   [harness.md](../../../install-instructions/harness.md), and changed owner
   settings by [omp.md](../../../install-instructions/omp.md). Run the checks
   of the changed parts and ask the owner to start a new omp session.
5. In `<clone>`: `git worktree remove <worktree>` and `git branch -D <task>`
   (after a squash merge git does not count the branch as merged).

## lcm

The sources are `crates/lcm-native`; the ready files are the `lcm` release of
this repository, built only by the GitHub Actions workflow
`.github/workflows/lcm-native.yml`. A push to `master` that changes the crate
or the workflow starts it; otherwise start it by hand. Wait for it and check
that the release notes name the pushed commit:

```bash
RUN="$(gh run list -R ARQAWA/my-omp-harness -w lcm-native -L 1 --json databaseId -q '.[0].databaseId')"
gh run watch "$RUN" -R ARQAWA/my-omp-harness --exit-status && gh release view lcm -R ARQAWA/my-omp-harness --json body -q .body
```

Without a push that started it, run `gh workflow run lcm-native.yml -R ARQAWA/my-omp-harness`
first. Then update the module on the current host by step 7 of
[harness.md](../../../install-instructions/harness.md).

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
