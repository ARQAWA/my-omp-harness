---
name: release
description: Release or install my-omp-harness; ordinary edits do not trigger release.
---

# Release

Общий статус и границы установки: [INSTALL_FOR_AGENTS.md](../../../INSTALL_FOR_AGENTS.md).

Триггер: «выпустить» либо «установить» или «обновить» harness или herdr. Обычное
редактирование release не запускает.

## 1. Область и источники

Определи заказанные части в порядке заказа. Прочитай `INSTALL_FOR_AGENTS.md` и
нужные `install-instructions/*.md`. Сохрани чужой delta.

Полный release — source commit, push и установка на текущем хосте. Частичный
заказ выполняет только свою часть. Analysis-only состояние не меняет. Install-only
идёт по инструкциям установки, без коммита и push. Уже выполненные части
переиспользуй.

## 2. Версия и проверки

Версия — это коммит: номера и теги не добавляй. Единственный тег и релиз —
`herdr` (раздел 5).

Если файлы менялись после последнего прогона, один раз запусти
`node tests/run.mjs` перед коммитом; повтор — только после исправления
выявленного сбоя. Остальные проверки выполняй, когда они заказаны или требуются
выбранной инструкцией.

## 3. Исходный коммит

Перед коммитом выполни обязательный [finalize-work](../finalize-work/SKILL.md) с
`review_stage=pre-action` на полном сдаваемом результате. CLEAN переиспользуй,
пока результат и основания неизменны. Тот же gate обязателен перед push и
завершением release.

`git add` выполняй только для точных путей; чужой delta не включай. Затем commit,
а при полном release — `git push origin master`.

## 4. Установка на текущем хосте

Пакет загружается из этого клона: убедись командой
`omp config get extensions --json`, что путь клона есть в списке. Если изменился
`SYSTEM.md`, обнови копию по `install-instructions/system-prompt.md`. Если
изменились требования (например, `modelRoles`), примени их по
`install-instructions/harness.md`. Выполни проверки изменённых частей и попроси
владельца перезапустить omp. Другие машины обновляются по `INSTALL_FOR_AGENTS.md`.

## 5. herdr

Исходники — приватный форк `ARQAWA/herdr`, готовые файлы — релиз `herdr` этого
репозитория. В форке работает только ручной workflow
`build-artifacts-manual.yml`; по умолчанию он собирает все системы с
`ReleaseFast` и SIMD. Выпуск herdr: commit и push в `master` форка, затем сборка
(около 10 минут) и замена файлов релиза:

```bash
RUN="$(gh workflow run build-artifacts-manual.yml -R ARQAWA/herdr | grep -o '[0-9]*$')"
gh run watch "$RUN" -R ARQAWA/herdr --exit-status
D="$(mktemp -d)" && gh run download "$RUN" -R ARQAWA/herdr -D "$D" && gh release upload herdr -R ARQAWA/my-omp-harness --clobber "$D"/*/herdr-* && gh release edit herdr -R ARQAWA/my-omp-harness --notes "ARQAWA/herdr $(gh run view "$RUN" -R ARQAWA/herdr --json headSha -q .headSha)"; rm -rf "$D"
```

Затем обнови herdr на текущем хосте по `install-instructions/herdr.md`.

## 6. Ошибки

При неопределённом push, сборке, загрузке или установке сначала прочитай
состояние (`git status`, `git log -1 origin/master`, `gh run list`,
`gh release view herdr`, `omp config get …`). Не повторяй вслепую. Сообщи
незавершённый этап и не объявляй release завершённым.
