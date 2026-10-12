# Installation instructions for agents

This is the single entry point for installing and updating the repository's
components. Use the exact selected revision (the clone's current commit) and the
instructions of the requested components only. The sources of installation actions
are this document, the selected instruction and the dependencies it names
explicitly. `AGENTS.md` describes development, lies outside the installation
procedure and is not a source of extra steps for it. Reuse compatible
dependencies that are already in place. Do not install the other components
automatically.

For an update or release on an installed host, apply only the changed parts of
the requested components. Reuse valid installation evidence for unchanged
inputs; run the selected instructions' checks whose values, files, dependencies
or loading behavior changed. Do not turn an update into a full first
installation or add model calls and trial tasks not required by those instructions.

If the session is not running inside a clone of this repository, first clone
`https://github.com/ARQAWA/my-omp-harness.git` into a permanent folder (by default
`~/my-omp-harness`). The clone is the installed copy: omp loads the package
straight from it, so it must not be moved or deleted.

| Component | Instruction |
|---|---|
| omp and the owner's settings (theme, context windows, status line and the other omp settings) | [`install-instructions/omp.md`](install-instructions/omp.md) |
| The harness package (Gold Standard, skills, agents, model routing, service extensions) | [`install-instructions/harness.md`](install-instructions/harness.md) |
| System prompt | [`install-instructions/system-prompt.md`](install-instructions/system-prompt.md) |
| herdr (our build) | [`install-instructions/herdr.md`](install-instructions/herdr.md) |

A full installation includes all components in the order of the table: the
package needs omp, the system prompt needs the package because the package
supplies the skills the prompt leaves out, and the herdr integration needs omp. On
Windows, run commands through the omp bash tool or Git Bash, without PowerShell
and cmd, except in two explicitly named places: the stock omp installer and the
`powershell.exe` call in the herdr instruction. A full release on the
development host installs the package, the prompt and the settings from the same
clone, without downloading the published revision back; herdr is always
installed from the `herdr` release.

The conditions of the working environments are described in
[WORKING-ENVIRONMENTS.md](WORKING-ENVIRONMENTS.md), and the installation follows
them. In the "Windows only inside VS Code" environment they change the
installation order and the way herdr and omp are started.

After the selected document, report the installed revision, the clone path, the
changes to `config.yml`, the `SYSTEM.md` path, the herdr path, the checks and the
remaining blockers.
