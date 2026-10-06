# herdr

Общий статус и границы установки: [INSTALL_FOR_AGENTS.md](../INSTALL_FOR_AGENTS.md).

## Состав

herdr — терминальный мультиплексор для агентов. Ставится наша сборка из
приватного форка `ARQAWA/herdr`: боковая панель в стиле Codex с разделами Pinned,
Projects и No project. Кнопка «+ window» открывает новое окно и не создаёт
проект. Проект окна — корень его Git-репозитория, а вне Git — папка окна;
проекты различаются по хэшу полного пути, поэтому папки с одинаковыми именами не
смешиваются. Окна в домашней папке и `/tmp` попадают в No project, а проект
исчезает из списка вместе с последним окном. Свёрнутая панель показывает только
кнопку `»`, которая разворачивает её обратно. Готовые файлы лежат
в релизе [`herdr`](https://github.com/ARQAWA/my-omp-harness/releases/tag/herdr)
этого репозитория, поэтому на машине не нужны ни компиляторы, ни доступ к форку.

| Система | Файл релиза | Куда ставится |
|---|---|---|
| macOS Apple Silicon | `herdr-macos-aarch64` | `~/.local/bin/herdr` |
| macOS Intel | `herdr-macos-x86_64` | `~/.local/bin/herdr` |
| Linux x86_64 | `herdr-linux-x86_64` | `~/.local/bin/herdr` |
| Linux ARM64 | `herdr-linux-aarch64` | `~/.local/bin/herdr` |
| Windows x64 | `herdr-windows-x86_64.zip` | `%LOCALAPPDATA%\Programs\herdr-arqawa\` |

В Windows `herdr.exe` работает только рядом с папкой `conpty` из того же архива.

Настройки лежат в `config.toml` herdr: `~/.config/herdr/` в macOS и Linux
(`$XDG_CONFIG_HOME/herdr/`, если переменная задана), `%APPDATA%\herdr\` в Windows.

```toml
onboarding = false

[ui]
status_indicators = "dots"
mouse_scroll_lines = 1

[update]
version_check = false
```

`version_check = false` выключает напоминание о новой версии обычного herdr:
`herdr update` поставил бы её поверх нашей сборки. Интеграция `omp` — расширение
`herdr-omp-agent-state.ts` в `<agent-dir>/extensions/` — сообщает herdr о
сессиях omp; без неё боковая панель не видит чатов.

## Требования

- Установленный [omp](omp.md).
- macOS и Linux: `curl`.
- Windows: bash-инструмент omp или Git Bash и `powershell.exe`, который скачивает
  и распаковывает архив и дописывает каталог в пользовательский `PATH`. Права
  администратора не нужны.
- Окружение «Windows только внутри VS Code» из
  [WORKING-ENVIRONMENTS.md](../WORKING-ENVIRONMENTS.md): omp заранее не нужен,
  а herdr запускает только расширение VS Code. Шаг 3 первой установки и
  проверку `integration status` выполняй после того, как omp поставлен и вошёл
  в провайдеров в окне herdr.

## Первая установка

1. Поставь файлы.

   macOS и Linux:

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

   Новый `PATH` виден только в новых окнах терминала, поэтому дальше herdr
   вызывается через `"$HERDR"`.
2. Если `config.toml` нет, создай его с текстом из «Состава». Если он есть,
   добавь недостающие ключи в их таблицы и сохрани остальные; другое значение
   этих ключей меняй только с согласия владельца.
3. Выполни `"$HERDR" integration install omp`.
4. Попроси владельца открыть новое окно терминала и запустить `herdr`, а в
   окружении «Windows только внутри VS Code» — открыть herdr командой
   «Herdr: Open» расширения VS Code.

## Проверка после установки

1. `"$HERDR" --version` печатает версию.
2. В выводе `"$HERDR" integration status` строка omp начинается с `omp: current`.
3. macOS и Linux: `command -v herdr` печатает `$HOME/.local/bin/herdr`. Если
   первым в `PATH` найден другой herdr, например из Homebrew, или каталога
   `~/.local/bin` в `PATH` нет, сообщи владельцу.
4. Windows: `powershell.exe -NoProfile -Command '[Environment]::GetEnvironmentVariable("Path", "User")'`
   содержит каталог установки.

## Обновление

1. Попроси владельца остановить herdr командой `herdr server stop`: она
   закрывает все панели. В Windows без этого файл занят. В macOS и Linux файл
   заменяется и на ходу, а новая версия начинает работать после перезапуска
   сервера.
2. Повтори шаг 1 первой установки.
3. Выполни проверки. Если строка omp в `integration status` не начинается с
   `omp: current`, выполни `"$HERDR" integration install omp`.
