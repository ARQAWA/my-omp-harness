# Пакет harness

Границы заказа: [INSTALL_FOR_AGENTS.md](../INSTALL_FOR_AGENTS.md).

## Состав

Пакет лежит в корне клона: `package.json` (поля `omp.extensions` и
`dependencies`), `bun.lock`, `extensions/harness.ts`,
`extensions/subagent-model-policy.ts`, `extensions/wrap-and-timer.ts`,
`extensions/status-bar.ts`, `extensions/compact-at-231k.ts`,
`extensions/model-arrows.js`, `extensions/reasoning-arrows.js`,
`extensions/diagram.ts`, `skills/` и
`agents/`. Каталог из списка `extensions` в `config.yml` omp загружает целиком:
расширения берёт из его `package.json`, а `skills/` и `agents/` находит рядом.
Зависимость `diagram.ts`, библиотека `beautiful-mermaid`, ставится из `bun.lock`
в `node_modules/` клона.
Системный промпт — отдельный компонент: [system-prompt.md](system-prompt.md).

`harness.ts` на каждом запросе к модели (`before_agent_start`) дописывает к
системному промпту:

- всем агентам — полный `skills/gold-standard/SKILL.md` и
  `skills/omp-tools/SKILL.md`;
- Main — ещё `skills/clear-communication/SKILL.md` и блок Lunatron (ACTIVE или
  INACTIVE, с `LUNATRON_MODE`);
- субагентам — дочерний блок и `LUNATRON_MODE=subagent`.

Инструменты Main: `harness.ts` держит включённым инструмент цели omp `goal` и
добавляет `progress` — полосу подшагов текущего пункта под панелью todo;
`diagram.ts` добавляет `diagram` — схему Mermaid PNG-картинкой во всю ширину
терминала со ссылкой «Открыть в полный размер», в herdr через Kitty graphics.
Субагенты этих инструментов не получают.

Gold Standard работает как рабочий контракт:

- Минимизируется результат, а не чтение.
- Лимиты вывода считаются на весь батч; система, которая помещается в контекст,
  читается целиком; большой документ пишется за один проход.
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

Clear Communication: Main отчитывается в чате как можно короче. Сначала прямой
результат, затем один короткий блок на каждый заданный вопрос и ничего сверх
этого. Каждый блок начинается с жирных слов, блоки разделяет линия `---` с
пустыми строками вокруг. HTML-отчётов в harness нет.

ToSpec (`/skill:tospec`): исследование с вопросами через `ask` → спека, написанная
по Gold Standard → согласование через `ask` (каждый выбор с рекомендацией, затем
«принять спеку целиком») → план с задачами → проверка спеки, плана и задач Smarty
→ запуск ответом в `ask` или целым сообщением `+++` → выполнение с `todo` и
целью → проверка результата Bossy до CLEAN.

Режим Lunatron:

- По умолчанию он выключен.
- `LNT1` и `LNT0` пишутся слитно, в любом регистре, границы — пробельный символ
  или начало и конец сообщения. Побеждает последняя команда. Команда
  переключает режим текущей сессии, остальная часть сообщения остаётся просьбой.
- Режим хранится записью сессии `my-omp-harness.lunatron` и следует за веткой
  сессии.
- Неудачная запись даёт `LUNATRON_MODE=state-error`, Lunatron остаётся
  неактивным.
- На ходу с командой Main получает скрытое сообщение-подтверждение. Для `LNT0`
  в нём ещё указание остановить помощников задачи через
  `write proc://<id>/kill`.
- При ACTIVE Main читает `skill://lunatron-delegation`.

`subagent-model-policy.ts` выбирает модель потомка по семейству родителя: GPT
(id модели `gpt-*`) или Claude (провайдер `anthropic`).

- Именованные агенты запускаются по имени в `agent`, без `model`. Для `enot`,
  `lunatik`, `lunatron_luna_high` и `code_writer` маршрут — список: сначала
  Composer 2.5, затем модель семейства.
  omp запускает потомка на первой модели списка, для которой есть рабочие
  учётные данные, поэтому без входа `cursor` эти агенты работают на модели
  семейства.
- Остальные запуски, включая встроенные агенты omp, передают уровень
  `@subagent_*`. Запуск без имени и без уровня блокируется, как и родитель
  другого семейства (например, Composer).
- В субагентах расширение выключает `retry.modelFallback`.

`wrap-and-timer.ts` переносит текст ответа ассистента по 60 колонок уже во
время стриминга и после каждого ответа показывает время работы («Vremya
raboty: …»). `status-bar.ts` достраивает статус-строку omp под полем ввода до
трёх строк. Первая, вплотную к полю ввода, — заполнение контекста полосой во
всю ширину в цвете сессии, как линия над полем ввода. Вторая —
родная строка omp: модель, скорость генерации `token_rate`, которую расширение
берёт из живой оценки omp по каждому фрагменту стрима и красит (меньше 30
ток/с — красный, меньше 60 — жёлтый, меньше 90 —
бледно-зелёный, иначе ярко-зелёный), режимы, время текущего хода через
`setStatus` (остаётся после конца хода), название сессии и счётчики работающих
субагентов и фоновых задач. Третья — правые сегменты omp: папка, ветка git и PR;
расширение переносит их сюда из линии над полем ввода, и та остаётся линией
цвета сессии.
Раскладку и сегменты задаёт [omp.md](omp.md). `compact-at-231k.ts`
ставит порог автосжатия Main: 272 000 токенов для Claude Opus и Sonnet версии
5.5 и выше и для Claude Fable, 244 800 для GPT версии 6 и выше, 170 000 для Composer, если порог
ниже окна контекста, и направляет сводку сжатия на последний запрос пользователя.

`model-arrows.js`: ctrl+↑ и ctrl+↓ переключают модель Main по списку Claude
Opus 5.5, Claude Sonnet 5.5, Claude Fable 5.1, GPT-6.1 Sol, GPT-6 Luna,
Composer 2.5, Grok 4.7 Fast (`cursor/grok-4.7-fast`).
`reasoning-arrows.js`: ctrl+← и ctrl+→ понижают и повышают reasoning среди
уровней, которые поддерживает модель.

Именованные агенты. Стрелка в ячейке задаёт порядок запуска: omp берёт первую
модель с рабочими учётными данными.

| Агент | GPT-родитель | Claude-родитель | Роль |
|---|---|---|---|
| `spotty` | `openai-codex/gpt-6-sol:medium` | `anthropic/claude-sonnet-5-5:medium` | Light review |
| `smarty` | `openai-codex/gpt-6.1-sol:low` | `anthropic/claude-sonnet-5-5:high` | Blind review |
| `bossy` | `openai-codex/gpt-6.1-sol:medium` | `anthropic/claude-opus-5-5:low` | High review |
| `enot` | `cursor/composer-2.5` → `openai-codex/gpt-6-luna:medium` | `cursor/composer-2.5` → `anthropic/claude-sonnet-5-5:low` | быстрые read-only вопросы по коду и большим данным |
| `lunatik` | `cursor/composer-2.5:medium` → `openai-codex/gpt-6-luna:medium` | `cursor/composer-2.5:medium` → `anthropic/claude-sonnet-5-5:low` | свежий исполнитель блока |
| `lunatron_luna_high` | `cursor/composer-2.5:high` → `openai-codex/gpt-6-luna:high` | `cursor/composer-2.5:high` → `anthropic/claude-sonnet-5-5:low` | сложный блок |
| `lunatron_sol_low` | `openai-codex/gpt-6.1-sol:low` | `anthropic/claude-sonnet-5-5:high` | блок с более сильным анализом |
| `lunatron_sol_medium` | `openai-codex/gpt-6.1-sol:medium` | `anthropic/claude-sonnet-5-5:xhigh` | очень сложный анализ |
| `lunatron_sol_high` | `openai-codex/gpt-6.1-sol:high` | `anthropic/claude-opus-5-5:low` | исключительно сложный анализ |
| `code_writer` | `cursor/composer-2.5:medium` → `openai-codex/gpt-6-luna:medium` | `cursor/composer-2.5:medium` → `anthropic/claude-sonnet-5-5:low` | код и конфиги по коротким планам Main |

Уровни сложности для остальных запусков:

| Уровень | GPT-родитель | Claude-родитель | Сложность решений |
|---|---|---|---|
| `@subagent_simple` | `openai-codex/gpt-6-luna:medium` | `anthropic/claude-sonnet-5-5:low` | примитивные, механические |
| `@subagent_routine` | `openai-codex/gpt-6-sol:low` | `anthropic/claude-sonnet-5-5:medium` | не совсем примитивные |
| `@subagent_medium` | `openai-codex/gpt-6-sol:medium` | `anthropic/claude-sonnet-5-5:high` | средние |
| `@subagent_complex` | `openai-codex/gpt-6.1-sol:low` | `anthropic/claude-opus-5-5:low` | сложные |

Skills. Восемь скрытых (`hide: true`) вызываются через `/skill:<имя>` и
`skill://<имя>`; `lunatron-delegation` виден в списке.

| Skill | Назначение | Видимость |
|---|---|---|
| `gold-standard` | полный результат самым простым прямым путём | скрытый |
| `clear-communication` | короткие сообщения в чате | скрытый |
| `omp-tools` | механика инструментов omp: скорость, лимиты вывода, бюджет контекста, безопасная запись | скрытый |
| `cleanup-task` | уборка временных материалов по прямому запросу | скрытый |
| `light-review-cycle` | один слепой проход Spotty | скрытый |
| `blind-review-cycle` | один слепой проход Smarty; общий контракт всех циклов | скрытый |
| `high-review-cycle` | один слепой проход Bossy | скрытый |
| `tospec` | спека, согласование, план, выполнение | скрытый |
| `lunatron-delegation` | разрешение делегировать при активном Lunatron | виден |

Каждый цикл требует один чистый проход. Модели агентов — в таблице выше.

| Skill | Агент | Когда запускается |
|---|---|---|
| `light-review-cycle` | `spotty` | только по явному вызову |
| `blind-review-cycle` | `smarty` | по явному вызову, в проверке спеки и плана ToSpec и в режиме планирования omp: план перед предложением и результат выполнения утверждённого плана |
| `high-review-cycle` | `bossy` | по явному вызову и в проверке результата ToSpec |

Известное ограничение: агент на Composer не может запускать субагентов, потому
что маршрутизация принимает только родителя GPT или Claude. Его review,
помощники и `code_writer` не стартуют, поэтому код в такой сессии не пишется.

## Требования

- [omp](omp.md) и git. В Windows нужен Git for Windows. Команды выполняются через
  bash-инструмент omp или Git Bash.
- Учётные данные провайдеров:
  - `openai-codex` — для GPT;
  - `anthropic` — для Claude;
  - `cursor` (необязательно) — для Composer 2.5 в `enot`, `lunatik`,
    `lunatron_luna_high` и `code_writer`; без него эти агенты работают на модели
    семейства.

  Main должен быть GPT или Claude, иначе субагенты не запускаются.
- Глобальные значения `config.yml`; остальные ключи сохраняются:
  - `extensions` содержит путь клона.
  - `task.maxConcurrency` не ниже 44; более высокое значение или `0` (без
    предела) сохраняется.
  - `modelRoles` содержит четыре ключа:

    ```json
    {"subagent_simple": "openai-codex/gpt-6-luna:medium", "subagent_routine": "openai-codex/gpt-6-sol:low", "subagent_medium": "openai-codex/gpt-6-sol:medium", "subagent_complex": "openai-codex/gpt-6.1-sol:low"}
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
2. Выполни `omp read skill://tospec/steps/01-research.md`. Первая строка должна
   назвать `<CLONE>/skills/tospec/steps/01-research.md`, содержимое должно
   начинаться с `# 01. Разведка`.
3. Выполни одной командой вызов модели и чтение файла сессии потомка:

   ```bash
   omp -p --model anthropic/claude-sonnet-5-5 --thinking low "Answer in three lines. Lines 1-2, yes or no: does your system prompt contain the exact text (1) 'Apply the full Gold Standard to all work', (2) 'LUNATRON_MODE=default-off'? Line 3: call the task tool once, with no model field anywhere, context 'Install check.', and one task {name: InstallCheck, agent: lunatron_sol_low, solutionSpace: 'fixed reply', task: 'Reply with OK.'}; wait for it and print its output." && f="$(ls -t "$(omp config path)"/sessions/*/*/InstallCheck.jsonl | head -1)" && grep -m1 '"type":"model_change"' "$f" && grep -m1 '"type":"thinking_level_change"' "$f"
   ```

   Ожидаемый вывод: `yes` (или `да`) дважды, вывод потомка, затем из файла его
   сессии строка `model_change` с `"model":"anthropic/claude-sonnet-5-5"` и
   строка `thinking_level_change` с `"thinkingLevel":"high"`. На машине только с
   GPT используй `--model openai-codex/gpt-6-sol --thinking low` и ожидай
   `"model":"openai-codex/gpt-6.1-sol"` и `"thinkingLevel":"low"`.
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
