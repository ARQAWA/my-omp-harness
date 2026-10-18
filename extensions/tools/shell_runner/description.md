Hand running programs to a fast model (Haiku, medium effort) that runs exactly the commands given and reports what happened: tests, builds, scripts, installs, servers, and long or noisy runs whose output should not fill your context. The call returns at once with an id; the report arrives later as a message starting with `[shell_runner#N]`. Keep working meanwhile; do not wait or poll.

- Run a short command whose full output you need yourself with bash.
- `commands`: each exact command in order, which ones are independent and may run in parallel, the timeout of each, and for a server its start command, ready log line or port and whether it stays running. `on_fail`: stop or continue. `report`: which output lines to quote verbatim.
- Trust the report and use it as it is.
