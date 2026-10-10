---
name: subagent-brief
description: "Read before briefing codebase_explorer, code_writer or shell_runner: how root Main writes their self-contained briefs and uses their finals."
---

# Subagent brief

codebase_explorer, code_writer and shell_runner do not see your history and decide nothing, so each brief is the agent's whole input. Write it so the agent can act in its first round without exploring: every path it must read, every value it must keep, and the exact check or command. Settle every design choice yourself before briefing, because an open choice comes back as DECISION_REQUIRED and costs a round trip. The brief carries exactly the request's scope: no tests, files, commands or checks the request did not ask for, and an existing check, such as the project's test command, rather than a new one. Write it in the language of the agent's prompt and keep it short: the agent reads every named file itself, so give the decisions and facts it cannot see, not a restatement of the code. Put independent briefs in one `task` call and dependent ones in order; the call returns at once, so keep working and wait for a result only when the next step needs it.

- codebase_explorer: the question; the known paths, identifiers and sources; the expected answer, usually confirmed facts with exact file:line references or links and what stayed unresolved. Give independent questions to separate explorers in one call, and read yourself only the files a decision depends on.
- code_writer: the result as what will be true; the cwd and every target file, plus any other file it must read; the decisions to keep, with exact names, values, interfaces and formatting; the facts you already found, such as the current code to change or what callers pass; and the check command. Give each independent change its own brief. A snippet or exact edit is fine when it is shorter than a description. Put text that belongs in a code file, such as a string literal, into the brief verbatim, and keep documentation and prose out of it: they are your work.
- shell_runner: the cwd; each exact command in order, marking which ones are independent and may run in parallel; the timeout of each; whether to stop or continue when a command fails; for each app or server, the start command, its ready log line or port, and whether it stays running at the end; and which output lines to quote.

code_writer and shell_runner return one terse final with status DONE, PARTIAL or DECISION_REQUIRED. Use a final as it is and read the changed code only when acceptance needs it; for a fix or for the decision an agent asks for, send a new brief.

Example brief for code_writer: "Result: `parseDate` in `src/util/date.ts` also accepts ISO strings that end in `Z`. Target: only that file; cwd: the repository root. Keep the signature `parseDate(input: string): Date` and the existing error text. Fact: the pattern `/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/` rejects `Z`; extend it to accept `Z` or a `±hh:mm` offset. Check: `npm test -- date`."

Example brief for shell_runner: "cwd: the repository root. Run `npm run build` (timeout 120 s); if it fails, stop. Then run `npm test` and `npm run lint`; they are independent, run them in parallel (timeout 300 s each). Report every exit code and each failing test name with its error lines verbatim."
