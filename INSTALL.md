# Installing my-omp-harness

Instructions for an agent that installs this harness into omp on the owner's machine. Run every step in order; a repeated run is safe and only overwrites the same files. Ask the owner before replacing a file that exists and differs, and for every sign-in.

## 1. omp

If `omp --version` fails, install omp with its stock installer:

- macOS and Linux: `curl -fsSL https://omp.sh/install | sh`; the binary is `~/.local/bin/omp`, which must be in `PATH`.
- Windows, PowerShell: `irm https://omp.sh/install.ps1 | iex`; the binary is `%LOCALAPPDATA%\omp\omp.exe`, whose directory goes into the user `PATH`.

If omp is already installed, run `omp update`. Then the owner starts `omp` once and signs in to his providers with `/login`.

## 2. The harness

Clone the repository, or update an existing clone:

```bash
CLONE="$HOME/my-omp-harness"
[ -d "$CLONE/.git" ] && git -C "$CLONE" pull --ff-only || git clone https://github.com/ARQAWA/my-omp-harness.git "$CLONE"
AGENT_DIR="$(omp config path)"
```

## 3. Files

```bash
mkdir -p "$AGENT_DIR/themes"
cp "$CLONE/settings/titanium-arq.json" "$AGENT_DIR/themes/"
cp "$CLONE/SYSTEM.md" "$AGENT_DIR/SYSTEM.md"
```

For `models.yml` and `keybindings.yml` from `$CLONE/settings/`: copy the file into `$AGENT_DIR` when it is absent there; when it exists and differs, show `git diff --no-index "$AGENT_DIR/<file>" "$CLONE/settings/<file>"` and replace it only with the owner's consent.

## 4. Settings

Point omp at the package and set the harness settings. `extensions` replaces the whole list, so if the owner keeps other extension packages, add them to the array.

```bash
omp config set extensions "[\"$CLONE\"]"
omp config set disabledExtensions '["skill:approval"]'
omp config set compaction.methodOrder '["remote","soft"]'
omp config set compaction.supersedeReads false
omp config set compaction.dropUseless false
omp config set compaction.asyncEnabled true
omp config set compaction.experimentalContextManagement false
omp config set contextPromotion.enabled false
omp config set branchSummary.enabled false
omp config set extendedContext false
omp config set read.defaultLimit 3000
omp config set read.summarize.enabled false
omp config set tools.artifactSpillThreshold 100
omp config set tools.outputMaxColumns 100000
omp config set tools.intentTracing false
omp config set todo.enabled false
omp config set todo.reminders false
omp config set astGrep.enabled true
omp config set astEdit.enabled false
omp config set find.enabled off
omp config set glob.enabled true
omp config set checkpoint.enabled false
omp config set security.enabled false
omp config set task.disabledAgents '["task","scout","reviewer","security-reviewer","sonic"]'
omp config set textVerbosity low
omp config set theme.dark titanium-arq
omp config set statusLine.preset custom
omp config set statusLine.separator none
omp config set statusLine.contextLine off
omp config set statusLine.sessionAccent false
omp config set statusLine.transparent true
omp config set statusLine.compactThinkingLevel false
omp config set statusLine.showHookStatus false
omp config set statusLine.leftSegments '["model","token_rate","mode","status"]'
omp config set statusLine.rightSegments '["path","collab","stream","git","pr"]'
omp config set statusLine.segmentOptions '{"model":{"showThinkingLevel":true}}'
omp config set composer.shape rule
omp config set composer.tokenRate false
omp config set tasks.todoClearDelay 0
omp config set symbolPreset nerd
omp config set tui.tight true
omp config set tui.codexResetFireworks false
omp config set recap.enabled false
```

## 5. Font

The status bar uses Nerd Font icons. On macOS and Linux:

```bash
case "$(uname -s)" in Darwin) FONTS="$HOME/Library/Fonts" ;; *) FONTS="$HOME/.local/share/fonts" ;; esac
T="$(mktemp -d)" && curl -fsSL -o "$T/f.tar.xz" https://github.com/ryanoasis/nerd-fonts/releases/latest/download/IosevkaTerm.tar.xz && tar -xJf "$T/f.tar.xz" -C "$T" && mkdir -p "$FONTS" && cp "$T"/IosevkaTermNerdFontMono-*.ttf "$FONTS/"
command -v fc-cache >/dev/null && fc-cache -f "$FONTS"
```

On Windows, download `https://github.com/ryanoasis/nerd-fonts/releases/latest/download/IosevkaTerm.zip` and ask the owner to install the `IosevkaTermNerdFontMono-*.ttf` files from its context menu. Then the owner picks "IosevkaTerm Nerd Font Mono" as the terminal font.

## 6. VS Code on Windows (optional)

Where omp runs only inside VS Code on Windows, install the extension `omp-vscode.vsix` from the latest release of `ARQAWA/my-omp-harness` (`code --install-extension omp-vscode.vsix`). It needs Git for Windows at `C:\Program Files\Git`, downloads the latest omp.exe itself and opens omp with the command "OMP: New Tab".

## 7. Done

`omp config get extensions` shows the clone path, and a new `omp` session starts without extension errors. Report to the owner what was installed and every file you did not replace.
