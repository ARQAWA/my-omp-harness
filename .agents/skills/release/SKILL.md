---
name: release
description: Release or install my-omp-harness; ordinary edits do not trigger release.
---

# Release

General status and installation boundaries: [INSTALL_FOR_AGENTS.md](../../../INSTALL_FOR_AGENTS.md).

Trigger: «выпустить» (release), or «установить» (install) or «обновить» (update)
harness or herdr. Ordinary editing does not trigger release.

## 1. Scope and sources

Determine the ordered parts in the order of the request. Read
`INSTALL_FOR_AGENTS.md` and the needed `install-instructions/*.md`. Preserve
other people's delta.

A full release is a source commit, a push and installation on the current host.
A partial order carries out only its own part. Analysis-only does not change
state. Install-only follows the installation instructions, without a commit or
push. Reuse parts that are already done.

## 2. Version and checks

A version is a commit: do not add numbers or tags. The only tag and release is
`herdr` (section 5).

If files changed after the last run, run `node tests/run.mjs` once before the
commit; rerun only after fixing a failure it revealed. Run the other checks when
they are ordered or required by the selected instruction. Local omp settings are
reconciled with the repository by finalize-work (section 3).

## 3. Source commit

Before the commit run the mandatory [finalize-work](../finalize-work/SKILL.md)
with `review_stage=pre-action` on the full result to be handed over. Reuse the
CLEAN while the result and bases are unchanged. The same gate is mandatory before
the push and before finishing the release.

Run `git add` only for exact paths; do not include other people's delta. Then
commit, and for a full release `git push origin master`.

## 4. Installation on the current host

The package is loaded from this clone: make sure with
`omp config get extensions --json` that the clone's path is in the list. If
`SYSTEM.md` changed, update the copy under `install-instructions/system-prompt.md`.
If the requirements changed (for example `modelRoles`), apply them under
`install-instructions/harness.md`. Run the checks of the changed parts and ask the
owner to restart omp. Other machines are updated under `INSTALL_FOR_AGENTS.md`.

## 5. herdr

The sources are the private repository `ARQAWA/herdr`, derived from the upstream
herdr; the ready files are the `herdr` release of this repository. In that
repository only the manual workflow `build-artifacts-manual.yml` runs; by default
it builds all systems with `ReleaseFast` and SIMD. Releasing herdr: commit and
push to `master` of `ARQAWA/herdr`, then the build (about 10 minutes) and
replacement of the release files:

```bash
RUN="$(gh workflow run build-artifacts-manual.yml -R ARQAWA/herdr | grep -o '[0-9]*$')"
gh run watch "$RUN" -R ARQAWA/herdr --exit-status
D="$(mktemp -d)" && gh run download "$RUN" -R ARQAWA/herdr -D "$D" && gh release upload herdr -R ARQAWA/my-omp-harness --clobber "$D"/*/herdr-* && gh release edit herdr -R ARQAWA/my-omp-harness --notes "ARQAWA/herdr $(gh run view "$RUN" -R ARQAWA/herdr --json headSha -q .headSha)"; rm -rf "$D"
```

Then update herdr on the current host under `install-instructions/herdr.md`.

## 6. Errors

On an uncertain push, build, upload or installation, first read the state
(`git status`, `git log -1 origin/master`, `gh run list`,
`gh release view herdr`, `omp config get …`). Do not repeat blindly. Report the
unfinished stage and do not declare the release complete.
