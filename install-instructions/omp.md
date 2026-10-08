# omp и настройки владельца

Общий статус и границы установки: [INSTALL_FOR_AGENTS.md](../INSTALL_FOR_AGENTS.md).

## Состав

omp ставится штатным установщиком с omp.sh и обновляется командой `omp update`.
Поверх него применяются настройки владельца из каталога `settings/` клона:

- тема `titanium-arq` — копия [`settings/titanium-arq.json`](../settings/titanium-arq.json)
  в `<agent-dir>/themes/` и значение `theme.dark`;
- окна контекста — копия [`settings/models.yml`](../settings/models.yml) в
  `<agent-dir>/models.yml`: 400 000 токенов для GPT-6.1 Sol, GPT-6 Luna, Claude
  Opus 5.5, Sonnet 5.5, Haiku 5.5 и Fable 5.1, 250 000 для Composer 2.5; там же
  Composer 2.5 помечен моделью без reasoning (`reasoning: false`);
- остальные настройки — ключи `config.yml` из шага 4 первой установки: вид
  статус-строки и поля ввода, модели и провайдеры, работа агента и интерфейс.

Ключи `extensions`, `task.maxConcurrency` и роли `subagent_*` в `modelRoles`
задаёт [пакет harness](harness.md). Роль `default` выбирает владелец каждой
машины, служебный `setupVersion` ведёт сам omp; они не переносятся.

`<agent-dir>` — каталог, который печатает `omp config path`. Переключение модели
и reasoning ctrl-стрелками входит в [пакет harness](harness.md).

## Требования

- macOS, Linux или Windows 10/11. В Windows нужны PowerShell 5.1+ и Git for
  Windows; Git ставится без прав администратора вариантом «только для меня».
- Окружение «Windows только внутри VS Code» из
  [WORKING-ENVIRONMENTS.md](../WORKING-ENVIRONMENTS.md): omp там ставится и
  запускается только в окне herdr из расширения VS Code.
- Доступ к omp.sh и github.com. Проверено на omp 18.6.3.
- Клон репозитория: настройки берутся из его каталога `settings/`.

## Первая установка

1. Если `omp --version` не работает, omp ставит владелец или агент вне omp
   штатным установщиком. Если установлен bun, установщик ставит omp через него;
   иначе скачивает готовый файл:
   - macOS и Linux: `curl -fsSL https://omp.sh/install | sh` — файл
     `~/.local/bin/omp`; этот каталог должен быть в `PATH`;
   - Windows, PowerShell: `irm https://omp.sh/install.ps1 | iex` — файл
     `%LOCALAPPDATA%\omp\omp.exe`, каталог попадает в пользовательский `PATH`.

   Затем владелец запускает `omp` и входит в провайдеров командой `/login`.
2. Задай пути и скопируй тему:

   ```bash
   CLONE="$(git -C ~/my-omp-harness rev-parse --show-toplevel)"
   AGENT_DIR="$(omp config path)"
   mkdir -p "$AGENT_DIR/themes" && cp "$CLONE/settings/titanium-arq.json" "$AGENT_DIR/themes/"
   ```

3. Если `$AGENT_DIR/models.yml` нет, скопируй туда `$CLONE/settings/models.yml`.
   Если файл есть и отличается, покажи различия командой
   `git diff --no-index "$AGENT_DIR/models.yml" "$CLONE/settings/models.yml"` и
   замени файл только с согласия владельца.
4. Задай настройки владельца. Тема убирает только значок перед контекстом; три
   строки статуса под полем ввода и строку над ним собирает расширение
   `status-bar.ts` пакета harness.

   ```bash
   omp config set theme.dark titanium-arq
   omp config set statusLine.preset custom
   omp config set statusLine.separator none
   omp config set statusLine.contextLine off
   omp config set statusLine.sessionAccent true
   omp config set statusLine.transparent true
   omp config set statusLine.compactThinkingLevel false
   omp config set statusLine.showHookStatus false
   omp config set statusLine.leftSegments '["model","token_rate","mode","collab","stream","status"]'
   omp config set statusLine.rightSegments '["path","git","pr"]'
   omp config set statusLine.segmentOptions '{"model":{"showThinkingLevel":true}}'
   omp config set composer.shape rule
   omp config set composer.tokenRate false
   omp config set tasks.todoClearDelay 0
   omp config set symbolPreset unicode
   omp config set colorBlindMode false
   omp config set hideThinkingBlock false
   omp config set proseOnlyThinking true
   omp config set omitThinking true
   omp config set enabledModels '["cursor/composer-2.5","openai-codex/gpt-6.1-sol","openai-codex/gpt-6-luna","anthropic/claude-opus-5-5","anthropic/claude-sonnet-5-5"]'
   omp config set disabledProviders '["openrouter"]'
   omp config set retry.fallbackChains '{"openai-codex/*":[]}'
   omp config set extendedContext false
   omp config set codexResets.autoRedeem no
   omp config set steeringMode one-at-a-time
   omp config set contextPromotion.enabled true
   omp config set branchSummary.enabled false
   omp config set compaction.methodOrder '["snapcompact","handoff","shake","soft","remote"]'
   omp config set checkpoint.enabled true
   omp config set astGrep.enabled true
   omp config set find.enabled auto
   omp config set tools.intentTracing false
   omp config set tui.resizeScrollback rebuild
   omp config set tui.textSizing false
   omp config set tui.renderMermaid true
   omp config set tui.codexResetFireworks true
   omp config set tui.titleSpinner braille
   omp config set tui.titleState true
   omp config set display.collapseCompacted false
   omp config set display.showTurnTime false
   omp config set display.showTokenUsage false
   omp config set spelling.typoDetection false
   omp config set spelling.autocorrect false
   omp config set spelling.autocomplete off
   omp config set paste.largeMenuThreshold 100
   omp config set read.summarize.enabled false
   omp config set read.defaultLimit 3000
   omp config set tools.artifactSpillThreshold 100
   ```

5. Настройки действуют в новой сессии omp. Не прерывай текущую задачу ради
   перезапуска.

## Проверка после установки

1. `omp --version` печатает версию.
2. `cmp "$CLONE/settings/titanium-arq.json" "$AGENT_DIR/themes/titanium-arq.json"`
   ничего не печатает. Та же команда для `models.yml` ничего не печатает, если
   владелец не отказался от замены.
3. `omp config list` показывает для каждого ключа шага 4 его значение из этого
   шага.

## Обновление

1. Выполни `omp update`.
2. Повтори проверку 2. Отличающуюся тему скопируй заново; отличающийся
   `models.yml` заменяй, как в шаге 3 первой установки.
3. Если проверка 3 показывает другие значения, повтори шаг 4.
4. Новая версия и настройки действуют в новой сессии omp.
