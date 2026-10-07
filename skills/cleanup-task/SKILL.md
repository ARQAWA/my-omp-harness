---
name: cleanup-task
description: On a direct request, remove proven temporary materials of a task, including a finished ToSpec workspace.
hide: true
---

# Cleanup Task

Use only on a direct request; ordinary task cleanup happens inline under the
Gold Standard. Follow the request's exact scope and exclusions; only an explicit
discard permits removing unfinished materials. ToSpec preparation/readiness preserves inputs
needed for later execution.

Remove only exactly proven task-created temporary or intermediate files, directories, staging, extracted copies, temporary downloads, obsolete intermediate cache/package versions, and backups. Preserve deliverables, source/config/runtime result, final active cache/archive, research/report artifacts, and every pre-existing, user-owned, or ambiguous object, except the explicitly scoped finished ToSpec material below.

Preserve the todo list and the `local://` files it names, which are needed for continuation or later use; cleanup does not delete, move, or copy them.

## Finished ToSpec material

The user selected OS temporary storage and later cleanup for ToSpec outputs.
Use only the exact workspace locator for the current task, never a search for
all matching folders or the newest folder. Read its spec/plan headers and current
task evidence (for an older three-document workspace, also read its existing
tasks header) to establish ownership and actual completion of implementation and
required checks, or the user's explicit instruction to discard this exact task.
`READY FOR IMPLEMENTATION` is not completed implementation. Keep pending plans needed
by another agent; do not delete them at the end of specification preparation.

The target must be a real task-created `scope-focus-tospec-*` directory directly
inside the actual Node.js `os.tmpdir()`, outside the task's real target file areas
when any exist; no repository is required. Recheck canonical
paths and symlinks; do not follow a link into another workspace. Within that exact
directory remove only proven task-created spec.md, plan.md and known
intermediate material; a tasks.md from an older completed workspace is removable
only with the same ownership and completion proof. Remove the directory only if
empty. Preserve unknown files, other tasks and pre-existing repository
specs. Do not migrate, archive
or copy these documents into the repository as part of cleanup.

Before deletion, establish canonical paths, ownership and exclusions; reject
symlinks or paths that escape the proven target. Use exact known paths, not age,
names, tmp location or absence from Git as proof. No disk audit, recursive search
for rubbish or shared cache cleanup. Known consumers must finish using a target.
Enumerate exact targets and recheck their proof and exclusions immediately before
deletion. Prohibit `rm -f`, `--force`, globs and broad cleanup. Remove parents only when empty. Confirm
each selected target is absent and exclusions remain; an absent target needs no
action. Preserve ambiguous objects without treating their parent as disposable.
If required eligible cleanup cannot finish, retain necessary continuation and
report the concrete remaining work; do not claim full completion.
