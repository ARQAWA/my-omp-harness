---
name: release
description: Release, commit, push or install my-omp-harness; release, commit and push each order one full release (commit, push and installation on the current host); ordinary edits do not trigger release.
---

# Release

The words release, commit and push («релиз», «коммит», «пуш» and their verb
forms) each order one full release of this repository: finalize-work, commit,
push and installation on the current host. «Установить» or «обновить» without
them order installation only, by
[INSTALL_FOR_AGENTS.md](../../../INSTALL_FOR_AGENTS.md), without a commit or a
push. herdr and omp-vscode are released only when their sources changed or the
owner names them.
Skip the steps that are already done.

1. If files changed after the last run of `node tests/run.mjs`, run it once.
   Then run [finalize-work](../finalize-work/SKILL.md) with
   `review_stage=pre-action` on the whole result until CLEAN.
2. `git add` only the exact paths of the result, without other people's
   changes, then commit and `git push origin master`.
3. Install on the current host: `omp config get extensions --json` must list
   this clone. If `SYSTEM.md` changed, copy it by
   [system-prompt.md](../../../install-instructions/system-prompt.md); if the
   requirements changed, such as `modelRoles`, apply them by
   [harness.md](../../../install-instructions/harness.md). Run the checks of
   the changed parts and ask the owner to start a new omp session.

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
release:

```bash
D="$(mktemp -d)" && TAG="$(gh release view -R can1357/oh-my-pi --json tagName -q .tagName)" && cp omp-vscode/package.json omp-vscode/extension.js "$D" && gh release download "$TAG" -R can1357/oh-my-pi -p omp-windows-x64.exe -D "$D/bin" && mv "$D/bin/omp-windows-x64.exe" "$D/bin/omp.exe" && (cd "$D" && yes | npx --yes @vscode/vsce package --no-dependencies --target win32-x64 -o omp-vscode.vsix) && (gh release view omp-vscode -R ARQAWA/my-omp-harness >/dev/null 2>&1 || gh release create omp-vscode -R ARQAWA/my-omp-harness --title omp-vscode --notes "omp $TAG") && gh release upload omp-vscode -R ARQAWA/my-omp-harness --clobber "$D/omp-vscode.vsix" && gh release edit omp-vscode -R ARQAWA/my-omp-harness --notes "omp $TAG"
```

## Errors

When a push, build, upload or installation is uncertain, read the state first
(`git status`, `git log -1 origin/master`, `gh run list`,
`gh release view herdr`, `gh release view omp-vscode`, `omp config get …`) instead of repeating blindly,
report the unfinished stage and do not declare the release complete.
