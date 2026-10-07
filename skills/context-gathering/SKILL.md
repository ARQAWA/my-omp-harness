---
name: context-gathering
description: "Cursor-style context gathering for every model: glob, rg, read and bash, continuation lines, parallel calls, delegation by size."
hide: true
---

# Context gathering

Gather context with four tools: `glob` lists files (newest first, hidden files included, .gitignore applied), `rg` searches contents, `read` reads files, `bash` runs everything else. Prefer `rg` and `glob` over shell search. Parallelize independent calls: put every call that does not need another call's output in one response, and reason between responses only about the next batch.

A cut output ends with a line that says how to continue: `[Use offset=N to continue]` for `read`, `[Use path=<file>:<line>:chars:<start>+<count> to continue]` for `read` when one line is longer than the output (pass that string as `path`), `[Showing paginated results, limit=N, offset=M]` for `rg` (repeat the call with that `offset`), `... K more files ...` for `glob` (narrow the pattern or the directory). Continue only from that line, and never reread what is already in your context.

`rg` takes `path`, `glob`, `type`, `output_mode` (`content`, `files_with_matches`, `count`), `-i`, `-A`/`-B`/`-C`, `head_limit`, `offset` and `multiline`. Use `files_with_matches` to find where, `count` to size, `content` to see lines; narrow a noisy pattern with `path`, `glob` or `type`. `read` takes `path`, `offset` and `limit`; without `limit` it returns the whole file up to about 100,000 characters, and a directory path returns a tree.

Scale to the task. When the task names its paths or is a small change in a known place, read those files at once. Otherwise map the root with `glob`, open the entry documents, and search with one alternation of 10-30 task terms (identifiers, synonyms, singular and plural forms, every naming style in use, config keys, routes, messages). Do not read generated files, lockfiles or vendored code.

For a file above about 100,000 characters, follow its `[Use offset=N to continue]` and `[Use path=…:chars:… to continue]` lines when you need all of it, or read only the ranges your search hits point to.

Size only the paths the task needs, never a whole large repository; estimate one token per four bytes. When those paths plus the deliverable stay under about 150,000 tokens, or 100,000 on Composer, read everything yourself and write once. Otherwise read what fits and give the rest to `enot`: a full context triggers a slow compaction and rereading.

`enot` does not see your history. Its brief carries the question, the known paths, and the expected answer: facts with exact `file:line` and what stayed unresolved. Put all tasks of one wave in one `task` call. Results arrive on their own: keep working, call `wait` only when blocked, and never poll.

For a task that needs a whole system, such as a report, an audit or a migration, list the files with `glob`, then read every relevant file in the fewest batches the output limits allow; leave out tests, generated files and vendored code only when the context cannot hold everything. Write a large deliverable in one pass after that reading; read and write part by part only when the material and the deliverable together would not fit in the free context.
