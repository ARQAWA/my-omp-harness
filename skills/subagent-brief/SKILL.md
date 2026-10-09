---
name: subagent-brief
description: "Read before briefing codebase_explorer, code_writer or shell_runner: how root Main writes their self-contained briefs and uses their finals."
---

# Subagent brief

codebase_explorer, code_writer and shell_runner do not see your history and decide nothing, so each brief is the agent's whole input: write it so the agent starts at once and returns the result. Put independent briefs in one `task` call and dependent ones in order; the call returns at once, so keep working and wait for a result only when the next step needs it.

- codebase_explorer: the question; the known paths, identifiers, and sources; the expected answer, usually confirmed facts with exact file:line references or links and what stayed unresolved. Give independent questions to separate explorers in one call, and read yourself only the files a decision depends on.
- code_writer: the result; the target files and the cwd; the decisions to keep, including names, values, and interfaces; the facts, paths, and snippets it needs; the check to run. Give each independent change its own brief. A snippet or exact edit is fine when it is shorter than a description. Put text that belongs in a code file, such as a prompt string, into the brief verbatim.
- shell_runner: the cwd; the exact commands and their order; timeouts; whether to stop or continue when a command fails; which services stay running.

code_writer and shell_runner return one terse final with status DONE, PARTIAL, or DECISION_REQUIRED. Use a final as it is and read the changed code only when acceptance needs it; for a fix or for the decision an agent asks for, send a new brief.

Example brief for code_writer: "Result: `parseDate` in `src/util/date.ts` also accepts ISO strings that end in `Z`. Target: only that file; cwd: the repository root. Keep the signature `parseDate(input: string): Date` and the existing error text. Fact: the pattern on line 14 rejects `Z`; extend it to accept `Z` or a `±hh:mm` offset. Check: `npm test -- date`."
