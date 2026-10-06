# my-omp-harness

Harness для omp: системный промпт, Scope Focus (Gold Standard, правила общения,
планирование через todo, циклы проверки, ToSpec, cleanup-task), Lunatron (режим
делегирования `LNT1`/`LNT0` и пять рабочих агентов) и маршрутизация моделей
субагентов по семейству модели родителя. Два служебных расширения идут в том же
пакете: ответы ассистента переносятся по 60 колонок, после каждого ответа
показывается время работы, а порог автосжатия задан по модели
(Opus и Sonnet 272 000, GPT 244 800, Composer 170 000 токенов).
Harness перенесён из финальной версии
[my-codex-harness](https://github.com/ARQAWA/my-codex-harness).

## Установка на новой машине

Нужны omp и git; в Windows ещё Git for Windows. Сам omp владелец ставит один раз
штатным установщиком (в Windows: `irm https://omp.sh/install.ps1 | iex`). Всё
дальнейшее выполняется через bash-инструмент omp или Git Bash.

1. Склонируй репозиторий в постоянную папку:
   `git clone https://github.com/ARQAWA/my-omp-harness.git ~/my-omp-harness`.
2. Запусти omp в этой папке и попроси: «Установи harness по
   INSTALL_FOR_AGENTS.md». Агент подключит пакет, настроит omp, установит
   системный промпт и выполнит проверки. После этого перезапусти omp.

## Обновление

В папке клона попроси omp: «Обнови harness по INSTALL_FOR_AGENTS.md».

## Документы

- [INSTALL_FOR_AGENTS.md](INSTALL_FOR_AGENTS.md) — точка входа для установки и обновления.
- [install-instructions/harness.md](install-instructions/harness.md) — пакет harness.
- [install-instructions/system-prompt.md](install-instructions/system-prompt.md) — системный промпт.
- [AGENTS.md](AGENTS.md) — разработка и release.
- [SCOPE-FOCUS-DESIGN.md](SCOPE-FOCUS-DESIGN.md) — концепция Scope Focus.
- [LUNATRON-DESIGN.md](LUNATRON-DESIGN.md) — концепция Lunatron.
