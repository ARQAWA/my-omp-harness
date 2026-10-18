Persistent shell: one fact command/pipeline; dependencies use `&&`.
Scripts/heredocs/`$(…)`/complex pipelines → `eval`.
`cwd`, not `cd`; `pty` only interactive.
Internal URIs work as paths for builtins/coreutils, redirects, globs.
Without `timeout` a command has no deadline and is never killed, also in the background; set `timeout` in seconds to kill it after that time.
`block_until_ms`: how long to wait for a non-`pty` command before it moves to background job `bg_N`; default 60000; 0 starts it in the background at once, like `async: true`. Its result arrives automatically as a follow-up message. NEVER poll.
No `head`/`tail`/redirection; output trunc by default, full result at `artifact://<id>`.
Long-lived services: unique name; ready requires name; no async/timeout; pty defaults true. ready needs log regex or port (both if given); host defaults 127.0.0.1, ready.timeout 30s.
