# herdr

General status and installation boundaries: [INSTALL_FOR_AGENTS.md](../INSTALL_FOR_AGENTS.md).

## Contents

herdr is a terminal multiplexer for agents. Our build from the private fork
`ARQAWA/herdr` is installed: a Codex-style sidebar with the sections Pinned,
Projects and No project. The "+ window" button opens a new window and does not
create a project. A window's project is the root of its Git repository, and
outside Git the window's folder; projects are told apart by a hash of the full
path, so folders with the same name do not mix. Windows in the home folder and
`/tmp` go to No project, and a project disappears from the list together with
its last window. The collapsed sidebar shows only the `»` button, which expands
it back. The built-in theme `titanium-arq` gives herdr the look of omp from
[DESIGN-SYSTEM.md](../DESIGN-SYSTEM.md): grey surfaces, white-grey focus, one
status circle `●` (yellow working, red blocked, green done, grey idle) and Nerd
Font icons for the pin and the git branch. The ready files are in this repository's
[`herdr`](https://github.com/ARQAWA/my-omp-harness/releases/tag/herdr) release,
so the machine needs neither compilers nor access to the fork.

| System | Release file | Installed to |
|---|---|---|
| macOS Apple Silicon | `herdr-macos-aarch64` | `~/.local/bin/herdr` |
| macOS Intel | `herdr-macos-x86_64` | `~/.local/bin/herdr` |
| Linux x86_64 | `herdr-linux-x86_64` | `~/.local/bin/herdr` |
| Linux ARM64 | `herdr-linux-aarch64` | `~/.local/bin/herdr` |
| Windows x64 | `herdr-windows-x86_64.zip` | `%LOCALAPPDATA%\Programs\herdr-arqawa\` |

On Windows, `herdr.exe` works only next to the `conpty` folder from the same
archive.

The settings are in herdr's `config.toml`: `~/.config/herdr/` on macOS and Linux
(`$XDG_CONFIG_HOME/herdr/` if the variable is set), `%APPDATA%\herdr\` on
Windows.

```toml
onboarding = false

[ui]
status_indicators = "dots"
mouse_scroll_lines = 1
pane_scrollbars = false

[update]
version_check = false

[theme]
name = "titanium-arq"

[keys]
previous_workspace = "ctrl+up"
next_workspace = "ctrl+down"
new_workspace = ["prefix+shift+n", "ctrl+shift+n"]
```

ctrl+↑/↓ move through the sidebar rows (chats and windows without an agent)
from top to bottom, like through a menu, and stop at the topmost and the
bottommost row; rows of collapsed projects are skipped. On macOS ctrl+↑/↓ reach
the terminal only when the Mission Control and Application windows shortcuts
are off (System Settings → Keyboard → Keyboard Shortcuts → Mission Control).
ctrl+shift+N opens a new window. ctrl+shift+N differs from ctrl+N only if the
terminal sends CSI u or the kitty protocol (iTerm2: Settings → Profiles → Keys
→ "Report keys using CSI u").

`version_check = false` turns off the reminder about a new version of regular
herdr: `herdr update` would install it over our build. The `omp` integration,
the `herdr-omp-agent-state.ts` extension in `<agent-dir>/extensions/`, tells
herdr about omp sessions; without it the sidebar does not see chats.

## Requirements

- An installed [omp](omp.md).
- macOS and Linux: `curl`.
- Windows: the omp bash tool or Git Bash, and `powershell.exe`, which downloads
  and unpacks the archive and appends the directory to the user `PATH`.
  Administrator rights are not needed.
- The "Windows only inside VS Code" environment from
  [WORKING-ENVIRONMENTS.md](../WORKING-ENVIRONMENTS.md): omp is not needed in
  advance, and only the VS Code extension starts herdr. Run step 3 of the first
  installation and the `integration status` check after omp has been installed
  and signed in to the providers in a herdr window.

## First installation

1. Install the files.

   macOS and Linux:

   ```bash
   case "$(uname -s)-$(uname -m)" in
     Darwin-arm64) F=herdr-macos-aarch64 ;;
     Darwin-x86_64) F=herdr-macos-x86_64 ;;
     Linux-x86_64) F=herdr-linux-x86_64 ;;
     Linux-aarch64) F=herdr-linux-aarch64 ;;
   esac
   mkdir -p ~/.local/bin && curl -fsSL -o ~/.local/bin/herdr.new "https://github.com/ARQAWA/my-omp-harness/releases/download/herdr/$F" && chmod +x ~/.local/bin/herdr.new && mv -f ~/.local/bin/herdr.new ~/.local/bin/herdr
   HERDR=~/.local/bin/herdr
   ```

   Windows:

   ```bash
   powershell.exe -NoProfile -Command '$ProgressPreference = "SilentlyContinue"; $d = Join-Path $env:LOCALAPPDATA "Programs\herdr-arqawa"; $z = Join-Path $env:TEMP "herdr-windows-x86_64.zip"; Invoke-WebRequest -UseBasicParsing "https://github.com/ARQAWA/my-omp-harness/releases/download/herdr/herdr-windows-x86_64.zip" -OutFile $z; Expand-Archive -Force $z $d; Remove-Item $z; $p = [Environment]::GetEnvironmentVariable("Path", "User"); if (($p -split ";") -notcontains $d) { [Environment]::SetEnvironmentVariable("Path", "$d;$p", "User") }'
   HERDR="$LOCALAPPDATA/Programs/herdr-arqawa/herdr.exe"
   ```

   The new `PATH` is visible only in new terminal windows, so from here on herdr
   is called through `"$HERDR"`.
2. If `config.toml` does not exist, create it with the text from "Contents". If
   it exists, add the missing keys to their tables and keep the rest; change a
   different value of these keys only with the owner's consent.
3. Run `"$HERDR" integration install omp`.
4. Ask the owner to open a new terminal window and start `herdr`, and in the
   "Windows only inside VS Code" environment to open herdr with the
   "Herdr: Open" command of the VS Code extension.

## Post-installation check

1. `"$HERDR" --version` prints the version.
2. In the output of `"$HERDR" integration status`, the omp line starts with
   `omp: current`.
3. macOS and Linux: `command -v herdr` prints `$HOME/.local/bin/herdr`. If
   another herdr comes first in `PATH`, for example from Homebrew, or the
   `~/.local/bin` directory is not in `PATH`, tell the owner.
4. Windows: `powershell.exe -NoProfile -Command '[Environment]::GetEnvironmentVariable("Path", "User")'`
   contains the installation directory.

## Update

1. Ask the owner to stop herdr with `herdr server stop`: it closes all panes. On
   Windows the file is locked without this. On macOS and Linux the file is
   replaced even while running, and the new version starts working after the
   server restarts.
2. Repeat step 1 of the first installation.
3. Run the checks. If the omp line in `integration status` does not start with
   `omp: current`, run `"$HERDR" integration install omp`.
