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

- root Main — полный `skills/gold-standard/SKILL.md`,
  `skills/omp-tools/SKILL.md`, `skills/main-workflow/SKILL.md` и
  `skills/clear-communication/SKILL.md`;
- субагенту — только `skills/omp-tools/SKILL.md`. Первый блок промпта
  (`SYSTEM.md` и список skills) у субагента убирается: он работает по своему
  определению и брифу.

На провайдере `cursor` root Main дополнительно получает таблицу имён
инструментов Cursor (ниже). Субагенты на этот провайдер не маршрутизируются и
таблицу не получают.

Инструменты Main: `harness.ts` держит включённым инструмент цели omp `goal` и
добавляет `progress` — полосу подшагов текущего пункта под панелью todo;
`diagram.ts` добавляет `diagram` — схему Mermaid PNG-картинкой во всю ширину
терминала со ссылкой «Открыть в полный размер», в herdr через Kitty graphics.
Субагенты этих инструментов не получают. `rg.ts` даёт всем агентам, в том числе
`codebase_explorer`, `smarty` и `bossy`, один набор сбора контекста, как в Cursor:
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
провайдере `cursor` набор не меняется: `rg`, `glob` и `edit` остаются MCP-инструментами,
а `grep` возвращается, потому что через него мост omp исполняет родные Grep и Glob.
`harness.ts` добавляет на этом провайдере запрет родных Glob и Grep, точные аргументы
MCP `glob` и `rg` с примерами и таблицу имён: родные Read, Shell, StrReplace, Write,
Delete и TodoWrite выполняют `read`, `bash`, `edit`, `write`, `delete` и `todo`, а
субагенты и цели идут через MCP `task` и `goal`. Правки у моделей на родных провайдерах работают без меток `[PATH#TAG]`:
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
`grep`, `glob`. `smarty` и `bossy` получают `read, glob, rg`, `shell_runner` —
`bash, read, rg`, `codebase_explorer` — `bash, read, glob, rg`, где `bash` только
для запросов к внешним источникам. Определение `codebase_explorer` задаёт жадный
поиск: одна альтернатива `rg` из 10–30 терминов, целые файлы параллельными
пачками и остановка, когда ответ подтверждён; тот же порядок действует для вики,
трекеров, PR и чатов.

Gold Standard работает как рабочий контракт:

- Агент идёт самым коротким прямым путём: собирает минимум нужных сведений,
  углубляется только на спорном месте и только до его закрытия, а решение
  выбирает по экспертизе, документации и логике, без опытов и замеров.
- Тяжёлая работа (глубокий ресёрч, сравнение вариантов, опыты, замеры, новые
  тесты, проверки сверх покрывающих изменение, лишние review и субагенты) идёт
  только по прямому приказу пользователя или по принятой процедуре.
- Существующие проверки запускаются один раз после изменения кода.
- Review запускаются только по явному выбору, кроме двух проверок ToSpec (спеки,
  плана и задач Smarty перед запуском и результата выполнения Bossy) и двух
  проверок режима планирования из `main-workflow`. Каждая проверка идёт до
  CLEAN. Других автоматических review в пакете нет; gate финализации
  репозитория harness — его локальный skill вне пакета.

`omp-tools` ставит на первое место скорость результата, на второе — число ходов:
независимые вызовы идут в одном ответе или в JS-ячейке `eval` с `Promise.all`,
лимиты вывода считаются на весь батч, временные файлы создаются только во
временной папке ОС, которую чистит система. Поиск по незнакомым файлам, несколько
раундов поиска, внешние источники и материал больше своего контекста root Main
передаёт `codebase_explorer` по разделу маршрутизации `SYSTEM.md`, а брифы
`codebase_explorer`, `code_writer` и `shell_runner` пишет по видимому skill
`subagent-brief`.

`main-workflow` действует только для root Main:

- Root Main автоматически ведёт список `todo` для каждой задачи из двух и более
  шагов и показывает подшаги текущего пункта через `progress`. Список хранит
  этапы с черновыми решениями; находки лежат в файлах `local://<тема>.md`,
  названных в пунктах списка.
- Для задачи из нескольких зависимых этапов root Main сам ставит цель (`goal`) и
  завершает её только после результата и обязательных действий. Просьба
  продолжить работу или цель снимает цель с паузы.
- В режиме планирования omp Blind Review (Smarty) проверяет план перед
  предложением на утверждение и результат выполнения утверждённого плана.

Clear Communication: Main пишет в чате не больше трёх абзацев по 2–4
предложения, разделённых линией `---` с пустыми строками вокруг. Вверху детали,
ниже причины, в последнем абзаце жирный главный итог и вопрос. Там же правила
промежуточных сообщений и самодостаточного итогового ответа. Блоки с жирными
подписями — подробный вид только по прямой просьбе; в ToSpec обсуждение и
утверждение спеки могут удлинить абзац или добавить новый. HTML-отчётов в
harness нет.

ToSpec (`/tospec <задача>`): режим расширения `tospec.ts`. Исследование коротким
путём с вопросами через `ask` → спека ровно из запрошенного и согласованного →
согласование через
`ask` (каждый выбор с рекомендацией, затем «принять спеку целиком») → переход
`plan` (reasoning на ступень ниже) → план с задачами → проверка спеки, плана и
задач Smarty → переход `ready` и полноэкранное окно одобрения: оглавление и
прокручиваемые spec.md и plan.md, выбор модели исполнителя и reasoning
(shift+↑↓, shift+←→), пункт `Launch in a new chat` запускает выполнение в новом
чистом чате (последний исполнитель запоминается) → выполнение с `todo` и целью → проверка
результата Bossy до CLEAN. В подготовке запись файлов разрешена только в workspace и
`local://`; служебные адреса `agent://`, `proc://` и `xd://` файлами не являются. `/tospec review` (и `/tospec` без аргумента) открывает окно в фазе
ready, `/tospec off` выключает режим.

`subagent-model-policy.ts` выбирает модель потомка по семейству родителя:
родитель GPT (id модели `gpt-*`) получает GPT-маршрут, любой другой родитель
(Claude и прочие) — Claude-маршрут.

- Именованные агенты запускаются по имени в `agent`, без `model`. У каждого одна
  модель на семейство родителя; все пять идут на Haiku 5.5 под любым родителем:
  `smarty` на `anthropic/claude-haiku-5-5:high`, остальные на
  `anthropic/claude-haiku-5-5:xhigh`. Без входа `anthropic` эти агенты не
  запускаются.
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
5.5 и выше и для Claude Fable, 100 000 для Claude Haiku, 244 800 для GPT версии 6 и выше, если порог
ниже окна контекста, и направляет сводку сжатия на последний запрос пользователя.

`model-arrows.js`: shift+↑ и shift+↓ переключают модель Main по списку Claude
Opus 5.5, Claude Sonnet 5.5, Claude Haiku 5.5, Claude Fable 5.1, GPT-6.1 Sol,
GPT-6 Luna, GPT-5.6 Luna.
`harness.ts`: ctrl+shift+P ставит активную цель на паузу, повторное нажатие
возобновляет её (расширение подставляет `/goal pause` или `/goal resume` в пустое
поле ввода); клавиша доходит отдельно от ctrl+P только в терминале с протоколом
kitty или CSI u. shift+↑ работает благодаря `keybindings.yml` из [omp.md](omp.md).
`reasoning-arrows.js`: shift+← и shift+→ понижают и повышают reasoning среди
уровней, которые поддерживает модель; добавлен no reasoning (`off`): у Sonnet
5.5 — `between_tools` с effort medium, у Haiku 5.5 — мышление выключено
(`thinking: disabled`) с effort high; хук запроса ставит их при отправке.

Именованные агенты:

| Агент | GPT-родитель | Claude-родитель | Роль |
|---|---|---|---|
| `smarty` | `anthropic/claude-haiku-5-5:high` | `anthropic/claude-haiku-5-5:high` | Blind review |
| `bossy` | `anthropic/claude-haiku-5-5:xhigh` | `anthropic/claude-haiku-5-5:xhigh` | High review |
| `codebase_explorer` | `anthropic/claude-haiku-5-5:xhigh` | `anthropic/claude-haiku-5-5:xhigh` | жадный read-only поиск по коду и внешним источникам |
| `code_writer` | `anthropic/claude-haiku-5-5:xhigh` | `anthropic/claude-haiku-5-5:xhigh` | код и конфиги по брифам Main |
| `shell_runner` | `anthropic/claude-haiku-5-5:xhigh` | `anthropic/claude-haiku-5-5:xhigh` | запуски программ по брифам Main |

Уровни сложности для остальных запусков:

| Уровень | GPT-родитель | Claude-родитель | Сложность решений |
|---|---|---|---|
| `@subagent_simple` | `openai-codex/gpt-6-luna:low` | `anthropic/claude-sonnet-5-5:off` | примитивные, механические |
| `@subagent_routine` | `openai-codex/gpt-6-luna:medium` | `anthropic/claude-sonnet-5-5:medium` | не совсем примитивные |
| `@subagent_medium` | `openai-codex/gpt-6-luna:xhigh` | `anthropic/claude-sonnet-5-5:high` | средние |
| `@subagent_complex` | `openai-codex/gpt-6.1-sol:low` | `anthropic/claude-opus-5-5:low` | сложные |

Skills. Шесть скрытых (`hide: true`) вызываются через `/skill:<имя>` и
`skill://<имя>`; видимый `subagent-brief` Main читает перед брифом
`codebase_explorer`, `code_writer` или `shell_runner`.

| Skill | Назначение | Видимость |
|---|---|---|
| `gold-standard` | полный результат самым коротким прямым путём, тяжёлая работа только по прямому приказу | скрытый |
| `main-workflow` | режим планирования, `todo`, `progress` и цель root Main | скрытый |
| `clear-communication` | короткие сообщения в чате, промежуточные сообщения и итоговый ответ | скрытый |
| `omp-tools` | механика инструментов omp: сначала скорость результата, потом число ходов, лимиты вывода, безопасная запись, временные файлы во временной папке ОС | скрытый |
| `subagent-brief` | брифы `codebase_explorer`, `code_writer` и `shell_runner` и приёмка их final | видимый |
| `blind-review-cycle` | один слепой проход Smarty; общий контракт обоих циклов | скрытый |
| `high-review-cycle` | один слепой проход Bossy | скрытый |

Каждый цикл требует один чистый проход. Модели агентов — в таблице выше.

| Skill | Агент | Когда запускается |
|---|---|---|
| `blind-review-cycle` | `smarty` | по явному вызову, в проверке спеки и плана ToSpec и в режиме планирования omp: план перед предложением и результат выполнения утверждённого плана |
| `high-review-cycle` | `bossy` | по явному вызову и в проверке результата ToSpec |

## Требования

- [omp](omp.md) и git. В Windows нужен Git for Windows. Команды выполняются через
  bash-инструмент omp или Git Bash.
- Учётные данные провайдеров:
  - `openai-codex` — для GPT;
  - `anthropic` — для Claude и для всех именованных агентов под любым
    родителем.
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
   omp -p --model anthropic/claude-sonnet-5-5 --thinking low "Answer in three lines. Lines 1-2, yes or no: does your system prompt contain the exact text (1) 'Apply the full Gold Standard to all work', (2) 'Apply the following communication skill before every user-facing message'? Line 3: call the task tool once, with no model field anywhere, context 'Install check.', and one task {name: InstallCheck, agent: codebase_explorer, solutionSpace: 'fixed reply', task: 'Reply with OK.'}; wait for it and print its output." && f="$(ls -t "$(omp config path)"/sessions/*/*/InstallCheck.jsonl | head -1)" && grep -m1 '"type":"model_change"' "$f" && grep -m1 '"type":"thinking_level_change"' "$f"
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
