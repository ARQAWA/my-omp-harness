# my-omp-harness

Harness для omp: системный промпт, Scope Focus (Gold Standard, правила общения,
механика инструментов omp, инструмент `rg` без лимита в 20 файлов, планирование
через todo и цель с полосой прогресса, три цикла проверки, режим ToSpec
(`/tospec`)), агенты `codebase_explorer` (ищет по коду и внешним источникам),
`code_writer` (пишет код) и `shell_runner` (запускает тесты, сборки и приложения)
по брифам Main, ревьюеры `spotty`, `smarty` и `bossy` и маршрутизация моделей субагентов по семейству модели
родителя. Служебные расширения идут в том же пакете: схемы Mermaid выводятся
PNG-картинкой во всю ширину терминала, ответы ассистента переносятся по 60
колонок, над полем ввода показывается время последнего хода, порог автосжатия задан
по модели (Opus, Sonnet и Fable 272 000, Haiku 100 000, GPT версии 6 и выше 244 800 токенов),
shift+↑/↓ переключают модель, shift+←/→ — reasoning.

Полная сборка добавляет настройки владельца для omp (тема `titanium-arq`, окна
контекста, статус-строка и остальные настройки omp) и нашу сборку herdr —
терминального мультиплексора с
боковой панелью в стиле Codex. herdr собирается из приватного форка и
скачивается готовым файлом из релиза `herdr` этого репозитория.
Harness перенесён из финальной версии
[my-codex-harness](https://github.com/ARQAWA/my-codex-harness).

## Установка на новой машине

1. Поставь omp штатным установщиком: в macOS и Linux
   `curl -fsSL https://omp.sh/install | sh`, в Windows (PowerShell)
   `irm https://omp.sh/install.ps1 | iex`. В Windows ещё нужен Git for Windows,
   его можно поставить только для себя, без прав администратора. Запусти `omp`
   и войди в провайдеров командой `/login`.
2. Склонируй репозиторий в постоянную папку:
   `git clone https://github.com/ARQAWA/my-omp-harness.git ~/my-omp-harness`.
3. Запусти omp в этой папке и попроси: «Установи всё по INSTALL_FOR_AGENTS.md».
   Агент применит настройки omp, подключит пакет, установит системный промпт и
   herdr и выполнит проверки. После этого перезапусти omp и запусти `herdr` в
   новом окне терминала.

В окружении «Windows только внутри VS Code» порядок установки и запуск herdr и
omp другие: см. [WORKING-ENVIRONMENTS.md](WORKING-ENVIRONMENTS.md).

## Обновление

В папке клона попроси omp: «Обнови всё по INSTALL_FOR_AGENTS.md».

## Документы

- [INSTALL_FOR_AGENTS.md](INSTALL_FOR_AGENTS.md) — точка входа для установки и обновления.
- [install-instructions/omp.md](install-instructions/omp.md) — omp и настройки владельца.
- [install-instructions/harness.md](install-instructions/harness.md) — пакет harness.
- [install-instructions/system-prompt.md](install-instructions/system-prompt.md) — системный промпт.
- [install-instructions/herdr.md](install-instructions/herdr.md) — наш herdr.
- [AGENTS.md](AGENTS.md) — разработка и release.
- [SCOPE-FOCUS-DESIGN.md](SCOPE-FOCUS-DESIGN.md) — концепция Scope Focus.
- [WORKING-ENVIRONMENTS.md](WORKING-ENVIRONMENTS.md) — условия рабочих окружений.
