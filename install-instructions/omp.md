# omp and the owner's settings

General status and installation boundaries: [INSTALL_FOR_AGENTS.md](../INSTALL_FOR_AGENTS.md).

## Contents

omp is installed with the stock installer from omp.sh and updated with
`omp update`. The owner's settings from the clone's `settings/` directory are
applied on top of it:

- the `titanium-arq` theme: a copy of [`settings/titanium-arq.json`](../settings/titanium-arq.json)
  in `<agent-dir>/themes/` and the `theme.dark` value. Its palette follows the
  stock Cursor IDE: black and graphite backgrounds, white-grey and grey text,
  no accent color; green, yellow and red stay only as indicators of statuses,
  diffs and the bash and Python input modes, and omp's done and error marks
  are the circle `●`;
- font and icons: IosevkaTerm Nerd Font Mono, a narrow terminal font with
  built-in icons, from the official
  [ryanoasis/nerd-fonts](https://github.com/ryanoasis/nerd-fonts) releases, and
  `symbolPreset nerd`, so omp and the harness draw Nerd Font glyphs; every glyph
  they draw is in this font and takes one cell;
- context windows: a copy of [`settings/models.yml`](../settings/models.yml) at
  `<agent-dir>/models.yml`: 700 000 tokens for all GPT models (GPT-6.1 Sol,
  GPT-6 Sol, GPT-6 Luna, GPT-5.6 Luna), all Claude models (Opus 5.5, Sonnet 5.5,
  Haiku 5.5) and DeepSeek V4.1 Flash 1017, and 128 000 tokens for Venice:
  Uncensored; the file also pins DeepSeek V4.1 Flash 1017 on OpenRouter to the
  Baseten provider (`compat.openRouterRouting.only`);
- keys: a copy of [`settings/keybindings.yml`](../settings/keybindings.yml) at
  `<agent-dir>/keybindings.yml`: it frees shift+↑ (the built-in
  `app.message.dequeue` stays on alt+↑) so that it switches the model, and
  turns off model switching with ctrl+P (`app.model.cycleForward: []`);
- the other settings: the `config.yml` keys from step 4 of the first
  installation: the look of the status line and the input field, models and
  providers, agent work and the interface.

The keys `extensions` and `task.maxConcurrency` are set by the
[harness package](harness.md). omp itself maintains the service key
`setupVersion`; it is not carried over. The `default` role in `modelRoles` is
the start model: omp starts every new session without model selection and
continuation flags on Sonnet 5.5 with reasoning high.

`<agent-dir>` is the directory that `omp config path` prints. Switching the model
and reasoning with the shift arrows is part of the [harness package](harness.md).

## Requirements

- macOS, Linux or Windows 10/11. Windows needs PowerShell 5.1+ and Git for
  Windows; Git is installed without administrator rights with the "Only for me"
  option.
- The "Windows only inside VS Code" environment from
  [WORKING-ENVIRONMENTS.md](../WORKING-ENVIRONMENTS.md): there omp is installed
  and started only in a herdr window from the VS Code extension. The special
  build `omp-vscode/` starts the `omp.exe` built into it without herdr and is not
  part of this installation.
- Access to omp.sh and github.com.
- A clone of the repository: the settings are taken from its `settings/`
  directory.

## First installation

1. If `omp --version` does not work, the owner or an agent outside omp installs
   omp with the stock installer. If bun is installed, the installer installs omp
   through it; otherwise it downloads a ready file:
   - macOS and Linux: `curl -fsSL https://omp.sh/install | sh` — the file
     `~/.local/bin/omp`; this directory must be in `PATH`;
   - Windows, PowerShell: `irm https://omp.sh/install.ps1 | iex` — the file
     `%LOCALAPPDATA%\omp\omp.exe`; the directory goes into the user `PATH`.

   Then the owner starts `omp` and signs in to the providers with `/login`.
2. Set the paths and copy the theme:

   ```bash
   CLONE="$(git -C ~/my-omp-harness rev-parse --show-toplevel)"
   AGENT_DIR="$(omp config path)"
   mkdir -p "$AGENT_DIR/themes" && cp "$CLONE/settings/titanium-arq.json" "$AGENT_DIR/themes/"
   ```

3. If `$AGENT_DIR/models.yml` does not exist, copy `$CLONE/settings/models.yml`
   there. If the file exists and differs, show the differences with
   `git diff --no-index "$AGENT_DIR/models.yml" "$CLONE/settings/models.yml"` and
   replace the file only with the owner's consent. Do the same with
   `$CLONE/settings/keybindings.yml` and `$AGENT_DIR/keybindings.yml`.
4. Set the owner's settings. The theme removes only the icon in front of the
   context; the compaction bar and two status rows under the input field and the row above it
   are built by the harness package extension `status-bar.ts`.
   `startup.quiet true` removes the omp startup block: the logo with a hint and
   the "Model scope" line. For a compact screen, `tui.tight true` drops one
   column of side padding, `recap.enabled false` removes the recap block that
   omp adds to the transcript after idle time, `tui.codexResetFireworks false`
   removes the fireworks animation, and `statusLine.sessionAccent false` removes
   the random color per session, so the line above the input field stays grey.

   ```bash
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
   omp config set todo.reminders false
   omp config set symbolPreset nerd
   omp config set colorBlindMode false
   omp config set hideThinkingBlock true
   omp config set proseOnlyThinking false
   omp config set omitThinking false
   omp config set enabledModels '["anthropic/claude-opus-5-5","anthropic/claude-sonnet-5-5","openai-codex/gpt-6.1-sol","openai-codex/gpt-6-sol","openai-codex/gpt-6-luna","openai-codex/gpt-5.6-luna","anthropic/claude-haiku-5-5","openrouter/deepseek/deepseek-v4.1-flash-1017","openrouter/cognitivecomputations/dolphin-mistral-24b-venice-edition"]'
   omp config set modelRoles '{"default":"anthropic/claude-sonnet-5-5:high"}'
   omp config set disabledProviders '[]'
   omp config set browser.enabled true
   omp config set computer.enabled true
   omp config set task.agentIdleTtlMs 120000
   omp config set task.disabledAgents '["task","scout","reviewer","security-reviewer","sonic"]'
   omp config set retry.fallbackChains '{"openai-codex/*":[]}'
   omp config set extendedContext false
   omp config set codexResets.autoRedeem no
   omp config set steeringMode one-at-a-time
   omp config set contextPromotion.enabled false
   omp config set branchSummary.enabled false
   omp config set compaction.methodOrder '["remote","soft"]'
   omp config set compaction.supersedeReads false
   omp config set compaction.dropUseless false
   omp config set compaction.asyncEnabled true
   omp config set checkpoint.enabled false
   omp config set astGrep.enabled true
   omp config set find.enabled off
   omp config set compaction.experimentalContextManagement false
   omp config set security.enabled false
   omp config set externalThinking false
   omp config set tools.intentTracing true
   omp config set tui.resizeScrollback rebuild
   omp config set tui.textSizing false
   omp config set tui.renderMermaid true
   omp config set tui.codexResetFireworks false
   omp config set tui.titleSpinner braille
   omp config set tui.titleState true
   omp config set tui.autoGraph off
   omp config set tui.reactions false
   omp config set tui.mouse false
   omp config set startup.quiet true
   omp config set tui.tight true
   omp config set recap.enabled false
   omp config set title.icons boring
   omp config set display.collapseCompacted true
   omp config set display.showTurnTime false
   omp config set display.showTokenUsage false
   omp config set display.subagentLivePreview false
   omp config set display.pinnedAgents off
   omp config set display.smoothStreaming true
   omp config set display.hideToolActivity false
   omp config set display.cacheMissMarker false
   omp config set task.showResolvedModelBadge false
   omp config set spelling.typoDetection false
   omp config set spelling.autocorrect false
   omp config set spelling.autocomplete off
   omp config set paste.largeMenuThreshold 100
   omp config set read.summarize.enabled false
   omp config set read.defaultLimit 3000
   omp config set tools.artifactSpillThreshold 100
   omp config set tools.outputMaxColumns 100000
   omp config set startup.setupWizard false
   omp config set startup.checkUpdate false
   omp config set terminal.showImages false
   omp config set autoResume false
   omp config set ida.enabled false
   omp config set github.enabled true
   omp config set plan.enabled false
   omp config set astEdit.enabled false
   ```

5. Install the Nerd Font; a repeated run only overwrites the same files. On
   macOS and Linux:

   ```bash
   case "$(uname -s)" in
     Darwin) FONTS="$HOME/Library/Fonts" ;;
     *) FONTS="$HOME/.local/share/fonts" ;;
   esac
   T="$(mktemp -d)" && curl -fsSL -o "$T/IosevkaTerm.tar.xz" https://github.com/ryanoasis/nerd-fonts/releases/latest/download/IosevkaTerm.tar.xz && tar -xJf "$T/IosevkaTerm.tar.xz" -C "$T" && mkdir -p "$FONTS" && cp "$T"/IosevkaTermNerdFontMono-*.ttf "$FONTS/"
   command -v fc-cache >/dev/null && fc-cache -f "$FONTS"
   ```

   On Windows, download the archive with
   `curl -fsSL -o "$USERPROFILE/Downloads/IosevkaTerm.zip" https://github.com/ryanoasis/nerd-fonts/releases/latest/download/IosevkaTerm.zip`
   and ask the owner to open it, select the `IosevkaTermNerdFontMono-*.ttf`
   files and choose "Install" in their context menu; this needs no
   administrator rights.

   Then ask the owner to choose "IosevkaTerm Nerd Font Mono" as the terminal
   font: in iTerm2 in Settings → Profiles → Text → Font; in the VS Code terminal
   with the `terminal.integrated.fontFamily` setting. Without the font, icons
   show as empty boxes; a Nerd Font build without "Mono" draws icons wider than
   one cell and shifts the rows.
6. The settings take effect in a new omp session. Do not interrupt the current
   task to restart.

## Post-installation check

1. `omp --version` prints the version.
2. `cmp "$CLONE/settings/titanium-arq.json" "$AGENT_DIR/themes/titanium-arq.json"`
   prints nothing. The same command for `models.yml` and `keybindings.yml`
   prints nothing unless the owner refused the replacement.
3. `omp config list` shows, for every key of step 4, its value from that step.
4. macOS and Linux: `ls "$FONTS" | grep IosevkaTermNerdFontMono-Regular` prints
   the font file. On Windows, the owner confirms that the font is installed.

## Update

1. Run `omp update`.
2. Repeat check 2. Copy a differing theme again; replace differing `models.yml`
   and `keybindings.yml` as in step 3 of the first installation.
3. If check 3 shows other values, repeat step 4.
4. The new version and the settings take effect in a new omp session.
