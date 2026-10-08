# Пакет harness

Границы заказа: [INSTALL_FOR_AGENTS.md](../INSTALL_FOR_AGENTS.md).

## Состав

Пакет лежит в корне клона: `package.json` (поля `omp.extensions` и
`dependencies`), `bun.lock`, `extensions/harness.ts`, `extensions/rg.ts`,
`extensions/subagent-model-policy.ts`, `extensions/wrap-and-timer.ts`,
`extensions/status-bar.ts`, `extensions/autocompaction.ts`,
`extensions/model-arrows.js`, `extensions/reasoning-arrows.js`,
`extensions/tospec.ts` с текстами процесса в `extensions/tospec/`,
`extensions/diagram.ts`, `skills/` и
`agents/`. Каталог из списка `extensions` в `config.yml` omp загружает целиком:
расширения берёт из его `package.json`, а `skills/` и `agents/` находит рядом.
Зависимость `diagram.ts`, библиотека `beautiful-mermaid`, ставится из `bun.lock`
в `node_modules/` клона.
Системный промпт — отдельный компонент: [system-prompt.md](system-prompt.md).

`harness.ts` на каждом запросе к модели (`before_agent_start`) дописывает к
системному промпту:

- всем агентам — полный `skills/gold-standard/SKILL.md`,
  `skills/omp-tools/SKILL.md` и `skills/context-gathering/SKILL.md`;
- Main — ещё `skills/clear-communication/SKILL.md`.

Инструменты Main: `harness.ts` держит включённым инструмент цели omp `goal` и
добавляет `progress` — полосу подшагов текущего пункта под панелью todo;
`diagram.ts` добавляет `diagram` — схему Mermaid PNG-картинкой во всю ширину
терминала со ссылкой «Открыть в полный размер», в herdr через Kitty graphics.
Субагенты этих инструментов не получают. `rg.ts` даёт всем агентам, в том числе
`enot`, `spotty`, `smarty` и `bossy`, один набор сбора контекста, как в Cursor:
`glob` (подменяет встроенный; `glob_pattern`, `target_directory`, новые файлы
первыми, скрытые включены, .gitignore применяется), `rg` (поиск по содержимому в
интерфейсе Cursor без лимита в 20 файлов на вызов, результат в
`<workspace_result>`, режима `files` нет) и `read` (подменяет встроенный для
локальных текстовых файлов: `path`, `offset`, `limit`; каждая десятая строка
пронумерована, длинный файл обрывается строкой `[Use offset=N to continue]`;
строка, которая не помещается в вывод, отдаётся фрагментами с хвостом
`[Use path=<файл>:<строка>:chars:<начало>+<длина> to continue]`, который
передаётся как `path`; каталог возвращается деревом). Вывод не превышает 100 000
символов и ~90 КБ, поэтому omp не вырезает середину. Остальные пути (URL,
`skill://`, архивы, изображения, `:conflicts`, `:img`) идут в родной `read`.
Встроенный `grep` в активном наборе удалён у моделей на родных провайдерах. На
провайдере `cursor` модель видит родные инструменты Cursor, поэтому `rg`, `glob` и
`edit` убираются как дубли родных Grep, Glob и StrReplace, а `grep` возвращается:
через него мост omp исполняет родные Grep и Glob. Роль без `grep` сохраняет `rg` и
`glob`. `harness.ts` добавляет на этом
провайдере таблицу имён: родные Read, Glob, Grep, Shell, StrReplace, Write, Delete и
TodoWrite выполняют `read`, `glob`, `rg`, `bash`, `edit`, `write`, `delete` и
`todo`, а субагенты и цели идут через MCP `task` и `goal`. Правки у моделей на родных провайдерах работают без меток `[PATH#TAG]`:
`apply_patch` для GPT, `replace` для остальных, переопределением настроек на
время сессии без записи в `config.yml`. Результат `bash` у моделей на родных
провайдерах приходит в обёртке Shell из Cursor (`Exit code`, `Command output`,
`Command completed in N ms.`). На провайдере `cursor` мост передаёт родные Grep,
Read и ls модели нашим обработчикам: запрос `grep` с маской в пути (`rust/*.rs`)
перед исполнением получает базовый каталог и `glob`, а результат заменяется
результатом движка `rg` без страниц в 20 файлов (смещение `skip` считается в
файлах; из `details.files` мост собирает ответ Glob и режима файлов Grep; родной
Glob приходит шаблоном `.`, его список ограничен 2 000 файлами, как в Cursor, и
метка обрезки ставится только при большем числе; текст обрезается на 2 000 строках префиксом файла со строкой
`[Output cut at 2000 lines in …; N more files not shown. Narrow the path or glob to see them]`); `read` этого
провайдера с селекторами `:raw`, `:N`, `:N+K`, `:N-M`, `:N-` обслуживает наш
`read`; мосту он отдаёт строки файла без маркеров и пометок пропуска (хвосты
`[Use offset=N to continue]` при обрезке бюджетом и хвост фрагмента длинной строки
остаются), потому что
нумерацию и пометки `... N lines not shown ...` сервер Cursor добавляет сам;
каталог возвращается плоским списком; мост вставляет `:raw` в адрес
фрагмента перед последним сегментом, `read` принимает обе формы. Дочерние задачи
режима планирования не получают расширений и остаются на встроенных `read`,
`grep`, `glob`. `enot` получает `read, glob, rg` без `bash`, `shell_runner` — `bash, read, rg`. Скрытый skill
`context-gathering` задаёт правила Cursor: `rg` и `glob` вместо поиска в
оболочке, независимые вызовы одной пачкой, продолжение по хвостам.

Gold Standard работает как рабочий контракт:

- Минимизируется результат, а не чтение.
- Лимиты вывода считаются на весь батч; большой документ пишется за один проход.
  Чтение системы целиком описано в `context-gathering`.
- Существующие проверки запускаются один раз после изменения кода.
- Временные файлы удаляются в последней команде, которая их использует.
- Root Main автоматически ведёт список `todo` для каждой задачи из двух и более
  шагов и показывает подшаги текущего пункта через `progress`. Список хранит
  этапы с черновыми решениями; находки лежат в файлах `local://<тема>.md`,
  названных в пунктах списка.
- Для задачи из нескольких зависимых этапов root Main сам ставит цель (`goal`) и
  завершает её только после результата и обязательных действий. Просьба
  продолжить работу или цель снимает цель с паузы.
- Для поиска по незнакомым файлам и для материала больше контекста стандарт
  запускает быстрого read-only агента `enot` через `task` по имени, без `model`.
- Review запускаются только по явному выбору, кроме двух проверок ToSpec (спеки,
  плана и задач Smarty перед запуском и результата выполнения Bossy) и двух
  проверок Blind Review (Smarty) в режиме планирования omp: плана перед
  предложением на утверждение и результата выполнения утверждённого плана.
  Каждая проверка идёт до CLEAN. Других автоматических review нет.

Clear Communication: Main пишет в чате не больше трёх абзацев по 2–4
предложения, разделённых линией `---` с пустыми строками вокруг. Вверху детали,
ниже причины, в последнем абзаце жирный главный итог и вопрос. Блоки с жирными
подписями — подробный вид только по прямой просьбе; в ToSpec обсуждение и
утверждение спеки могут удлинить абзац или добавить новый. HTML-отчётов в
harness нет.

ToSpec (`/tospec <задача>`): режим расширения `tospec.ts`. Исследование с
вопросами через `ask` → спека, написанная по Gold Standard → согласование через
`ask` (каждый выбор с рекомендацией, затем «принять спеку целиком») → переход
`plan` (reasoning на ступень ниже) → план с задачами → проверка спеки, плана и
задач Smarty → переход `ready` и полноэкранное окно одобрения: оглавление и
прокручиваемые spec.md и plan.md, выбор модели исполнителя и reasoning
(ctrl+↑↓, ctrl+←→), пункт `Launch in a new chat` запускает выполнение в новом
чистом чате (последний исполнитель запоминается) → выполнение с `todo` и целью → проверка
результата Bossy до CLEAN. В подготовке запись вне workspace и `local://`
блокируется. `/tospec review` (и `/tospec` без аргумента) открывает окно в фазе
ready, `/tospec off` выключает режим.

`subagent-model-policy.ts` выбирает модель потомка по семейству родителя:
родитель GPT (id модели `gpt-*`) получает GPT-маршрут, любой другой родитель
(Claude, Grok, Composer и прочие) — Claude-маршрут.

- Именованные агенты запускаются по имени в `agent`, без `model`. У каждого одна
  модель на семейство родителя; `enot`, `code_writer` и `shell_runner` идут на
  `anthropic/claude-haiku-5-5:xhigh` под любым родителем. Без входа `anthropic`
  эти агенты не запускаются.
- Остальные запуски, включая встроенные агенты omp, передают уровень
  `@subagent_*`. Запуск без имени и без уровня блокируется.
- В субагентах расширение выключает `retry.modelFallback`.

`wrap-and-timer.ts` переносит текст ответа ассистента по 60 колонок уже во
время стриминга. `status-bar.ts` достраивает статус-строку omp под полем ввода до
трёх строк и строку над линией акцента: слева «Worked …» за последний ход,
справа имя сессии. Первая строка под полем, вплотную к нему, — заполнение
контекста полосой во
всю ширину в цвете сессии, как линия над полем ввода. Вторая —
родная строка omp: модель, скорость генерации `token_rate`, которую расширение
берёт из живой оценки omp по каждому фрагменту стрима и красит (меньше 30
ток/с — красный, меньше 60 — жёлтый, меньше 90 —
бледно-зелёный, иначе ярко-зелёный), режимы (план и цель вместе), время текущего
хода через `setStatus` (остаётся после конца хода), фаза ToSpec и счётчики
работающих субагентов и фоновых задач. Третья — правые сегменты omp: папка, ветка
git и PR, справа — ID сессии;
расширение переносит их сюда из линии над полем ввода, и та остаётся линией
цвета сессии.
Раскладку и сегменты задаёт [omp.md](omp.md). `autocompaction.ts`
ставит порог автосжатия Main: 272 000 токенов для Claude Opus и Sonnet версии
5.5 и выше и для Claude Fable, 100 000 для Claude Haiku, 244 800 для GPT версии 6 и выше, 170 000 для Composer, если порог
ниже окна контекста, и направляет сводку сжатия на последний запрос пользователя.

`model-arrows.js`: ctrl+↑ и ctrl+↓ переключают модель Main по списку Claude
Opus 5.5, Claude Sonnet 5.5, Claude Haiku 5.5, Claude Fable 5.1, GPT-6.1 Sol,
GPT-6 Luna, Grok 4.7 (`cursor/grok-4.7`), Composer 2.5.
`reasoning-arrows.js`: ctrl+← и ctrl+→ понижают и повышают reasoning среди
уровней, которые поддерживает модель; добавлен no reasoning (`off`): у Sonnet
5.5 — `between_tools` с effort low, у Haiku 5.5 — мышление выключено
(`thinking: disabled`) с effort low; хук запроса ставит их при отправке.
У Composer 2.5 уровней reasoning нет: Cursor не даёт ему варианта или параметра
reasoning, поэтому `settings/models.yml` помечает его `reasoning: false`.

Именованные агенты:

| Агент | GPT-родитель | Claude-родитель | Роль |
|---|---|---|---|
| `spotty` | `openai-codex/gpt-6-sol:medium` | `anthropic/claude-opus-5-5:low` | Light review |
| `smarty` | `openai-codex/gpt-6.1-sol:low` | `anthropic/claude-opus-5-5:low` | Blind review |
| `bossy` | `openai-codex/gpt-6.1-sol:medium` | `anthropic/claude-opus-5-5:medium` | High review |
| `enot` | `anthropic/claude-haiku-5-5:xhigh` | `anthropic/claude-haiku-5-5:xhigh` | быстрые read-only вопросы по коду и большим данным |
| `code_writer` | `anthropic/claude-haiku-5-5:xhigh` | `anthropic/claude-haiku-5-5:xhigh` | код и конфиги по брифам Main |
| `shell_runner` | `anthropic/claude-haiku-5-5:xhigh` | `anthropic/claude-haiku-5-5:xhigh` | запуски программ по брифам Main |

Уровни сложности для остальных запусков:

| Уровень | GPT-родитель | Claude-родитель | Сложность решений |
|---|---|---|---|
| `@subagent_simple` | `openai-codex/gpt-6-luna:low` | `anthropic/claude-sonnet-5-5:off` | примитивные, механические |
| `@subagent_routine` | `openai-codex/gpt-6-luna:medium` | `anthropic/claude-sonnet-5-5:medium` | не совсем примитивные |
| `@subagent_medium` | `openai-codex/gpt-6-luna:xhigh` | `anthropic/claude-sonnet-5-5:high` | средние |
| `@subagent_complex` | `openai-codex/gpt-6.1-sol:low` | `anthropic/claude-opus-5-5:low` | сложные |

Skills. Восемь скрытых (`hide: true`) вызываются через `/skill:<имя>` и
`skill://<имя>`.

| Skill | Назначение | Видимость |
|---|---|---|
| `gold-standard` | полный результат самым простым прямым путём | скрытый |
| `clear-communication` | короткие сообщения в чате | скрытый |
| `omp-tools` | механика инструментов omp: скорость, лимиты вывода, безопасная запись | скрытый |
| `context-gathering` | сбор контекста как в Cursor: `glob`, `rg`, `read`, `bash`, хвосты продолжения, независимые вызовы одной пачкой, передача `enot` по размеру | скрытый |
| `cleanup-task` | уборка временных материалов по прямому запросу | скрытый |
| `light-review-cycle` | один слепой проход Spotty | скрытый |
| `blind-review-cycle` | один слепой проход Smarty; общий контракт всех циклов | скрытый |
| `high-review-cycle` | один слепой проход Bossy | скрытый |

Каждый цикл требует один чистый проход. Модели агентов — в таблице выше.

| Skill | Агент | Когда запускается |
|---|---|---|
| `light-review-cycle` | `spotty` | только по явному вызову |
| `blind-review-cycle` | `smarty` | по явному вызову, в проверке спеки и плана ToSpec и в режиме планирования omp: план перед предложением и результат выполнения утверждённого плана |
| `high-review-cycle` | `bossy` | по явному вызову и в проверке результата ToSpec |

## Требования

- [omp](omp.md) и git. В Windows нужен Git for Windows. Команды выполняются через
  bash-инструмент omp или Git Bash.
- Учётные данные провайдеров:
  - `openai-codex` — для GPT;
  - `anthropic` — для Claude и для `enot`, `code_writer`, `shell_runner` под
    любым родителем.
- Глобальные значения `config.yml`; остальные ключи сохраняются:
  - `extensions` содержит путь клона.
  - `task.maxConcurrency` не ниже 44; более высокое значение или `0` (без
    предела) сохраняется.
  - `tools.artifactSpillThreshold` не ниже 100 (по умолчанию omp ставит 50), иначе
    omp вырезает середину у чтений кусками по ~90 КБ; `read.defaultLimit`
    предполагается равным 3000.
  - `modelRoles` содержит четыре ключа:

    ```json
    {"subagent_simple": "openai-codex/gpt-6-luna:low", "subagent_routine": "openai-codex/gpt-6-luna:medium", "subagent_medium": "openai-codex/gpt-6-luna:xhigh", "subagent_complex": "openai-codex/gpt-6.1-sol:low"}
    ```

    Незаданная или недоступная роль останавливает запуск до маршрутизации;
    итоговую модель потом выбирает расширение по семейству родителя. Без входа
    `openai-codex` задай эти четыре роли значениями из столбца Claude-родителя.
    `default` и другие роли принадлежат владельцу и не меняются.
  - В Windows `shellPath` — путь к `bash.exe` из Git for Windows: через него идут
    сервисы, терминалы и `!`. Обычные вызовы bash-инструмента уже работают во
    встроенной POSIX-оболочке omp.

## Первая установка

Команды одинаковы в macOS и Windows (bash).

1. Если клона нет, склонируй репозиторий и запомни путь клона:

   ```bash
   git clone https://github.com/ARQAWA/my-omp-harness.git ~/my-omp-harness
   CLONE="$(git -C ~/my-omp-harness rev-parse --show-toplevel)"
   ```

   В macOS это `/Users/...`, в Windows — `C:/Users/...`.
2. Выполни `omp config get extensions --json`. Если в массиве нет `CLONE` (или
   записи с `~` для того же пути), выполни
   `omp config set extensions '<JSON-массив из прежних элементов и значения $CLONE>'`.
3. Выполни `omp config get task.maxConcurrency`. Если значение ниже 44 и не `0`,
   выполни `omp config set task.maxConcurrency 44`.
   Выполни `omp config get tools.artifactSpillThreshold`. Если значение ниже 100,
   выполни `omp config set tools.artifactSpillThreshold 100`.
4. Выполни `omp config get modelRoles --json`. Перезапиши четыре ключа
   `subagent_*` значениями из «Требований», остальные роли сохрани:
   `omp config set modelRoles '<объединённый JSON>'`.
5. Только в Windows: выполни `omp config get shellPath`. Если значение пустое,
   задай путь `bash.exe`: по умолчанию `C:/Program Files/Git/bin/bash.exe`, а
   при установке Git для одного пользователя —
   `%LOCALAPPDATA%/Programs/Git/bin/bash.exe` (переменная раскрывается в
   абсолютный путь).
6. Если системный промпт входит в заказ, установи его по
   [его инструкции](system-prompt.md).
7. Установи зависимости пакета из `bun.lock`:
   `BUN_BE_BUN=1 omp install --cwd "$CLONE" --frozen-lockfile`. Переменная
   `BUN_BE_BUN=1` запускает Bun, встроенный в omp; отдельный Bun не нужен.
8. Расширения загружаются в новом процессе omp. Попроси владельца перезапустить
   omp, не прерывая текущую задачу.

## Проверка после установки

Проверку выполняет устанавливающий агент на целевой ОС; `omp read` и `omp -p`
запускают новые процессы.

1. Перечитай значения из «Требований» командой `omp config get`.
2. Выполни `omp read skill://blind-review-cycle`. Первая строка должна
   назвать `<CLONE>/skills/blind-review-cycle/SKILL.md`, содержимое должно
   содержать `# Blind Review Cycle`.
3. Выполни одной командой вызов модели и чтение файла сессии потомка:

   ```bash
   omp -p --model anthropic/claude-sonnet-5-5 --thinking low "Answer in three lines. Lines 1-2, yes or no: does your system prompt contain the exact text (1) 'Apply the full Gold Standard to all work', (2) 'Apply the following communication skill before every user-facing message'? Line 3: call the task tool once, with no model field anywhere, context 'Install check.', and one task {name: InstallCheck, agent: enot, solutionSpace: 'fixed reply', task: 'Reply with OK.'}; wait for it and print its output." && f="$(ls -t "$(omp config path)"/sessions/*/*/InstallCheck.jsonl | head -1)" && grep -m1 '"type":"model_change"' "$f" && grep -m1 '"type":"thinking_level_change"' "$f"
   ```

   Ожидаемый вывод: `yes` (или `да`) дважды, вывод потомка, затем из файла его
   сессии строка `model_change` с `"model":"anthropic/claude-haiku-5-5"` и
   строка `thinking_level_change` с `"thinkingLevel":"xhigh"`.
4. Другие запросы к моделям и пробные задачи в проверку не входят.

## Обновление

1. Выполни `git -C "$CLONE" pull --ff-only`. Если есть локальные изменения или
   ветки разошлись, остановись и сообщи; ничего не перезаписывай.
2. Перепроверь значения из «Требований»: четыре роли `subagent_*` задай как там
   указано, более высокие пределы и остальные настройки сохрани.
3. Если системный промпт входит в заказ, обнови его по
   [его инструкции](system-prompt.md).
4. Выполни `BUN_BE_BUN=1 omp install --cwd "$CLONE" --frozen-lockfile`: команда
   ставит зависимости пакета из `bun.lock` и ничего не меняет, если они уже на
   месте.
5. Попроси владельца перезапустить omp: открытые сессии сохраняют прежний
   контекст.
6. Выполни проверки изменённых частей. Если изменились `extensions/` или
   `agents/`, включи проверку 3. Полную проверку первой установки без запроса не
   повторяй.


[You have received this identical output 6 times. Re-reading '/Users/arkadijcukavin/Documents/ChatGPT/my-omp-harness/install-instructions/harness.md:raw' will not change it — use a narrower selector (path:A-B), or proceed with the edit.]