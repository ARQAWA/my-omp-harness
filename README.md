# my-omp-harness

Harness для omp: системный промпт, Scope Focus (Gold Standard, правила общения,
планирование через todo, циклы проверки, ToSpec, cleanup-task), Lunatron (режим
делегирования `LNT1`/`LNT0` и пять рабочих агентов) и маршрутизация моделей
субагентов по семейству модели родителя. Служебные расширения идут в том же
пакете: ответы ассистента переносятся по 60 колонок, после каждого ответа
показывается время работы, порог автосжатия задан по модели
(Opus и Sonnet 272 000, GPT 244 800, Composer 170 000 токенов), ctrl+↑/↓
переключают модель, ctrl+←/→ — reasoning.

Полная сборка добавляет настройки владельца для omp (тема `titanium-arq`, окна
контекста, статус-строка) и нашу сборку herdr — терминального мультиплексора с
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
- [LUNATRON-DESIGN.md](LUNATRON-DESIGN.md) — концепция Lunatron.
