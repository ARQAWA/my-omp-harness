---
name: context-gathering
description: "Fixed cycle for gathering code context: one tool rule, map, one wide search, batch reads, continuation lines, stop."
hide: true
---

# Context gathering

Gather context in a few wide rounds, not many narrow ones. Each round is one response with every independent call in it. Between rounds, reason only about the next batch: do not retell what you read.

Tools: call `rg` when it is among your directly callable tools. Otherwise use your own search, file-listing and read tools directly: `grep`, `glob` and `read`, or Grep, Glob and Read under the Cursor provider. Never reach a tool through a dynamic tool lookup. The harness completes their results: search and listing have no hidden file caps, and a read too large for one output returns its first part whole.

Cut outputs: a cut output ends with a line that says how to continue, such as `Use :N to continue`, `skip=K`, `offset=K`, or ready `glob` calls. Continue only from that line, and never reread what is already in your context.

Scale to the task. When the task names its paths or is a small change in a known place, read those files at once and skip the map. Otherwise:

1. **Round 1.** In one response:
   - Map the task root: `rg` with `output_mode: files` lists every file with its line count and size; without `rg`, one `glob` of the root.
   - Open the entry documents (README, AGENTS.md, manifests).
   - Search with one alternation of 10-30 task terms in files-with-matches mode: identifiers, synonyms, singular and plural forms, every naming style in use, config keys, routes, messages.
   - Read the files the task already names.
2. **Round 2.** In one response:
   - Read every relevant file with a bare read, as parallel calls. Up to about 90 KB it returns the whole file; a larger file returns its first part and the line to continue from.
   - Run content searches with alternations, limited to the chosen scope, for definitions, callers, configuration and tests.
3. **Round 3.** Only targeted searches with exact names found so far, batched with the reads they imply. Then stop gathering and act. A fourth round needs a concrete missing fact.

`rg` takes `path`, `glob`, `type`, `-i`, `-A`/`-B`/`-C`, `head_limit`, `offset` and `multiline`. Its output is grouped per file and capped by `head_limit`; the footer names the next `offset`. Use `files` to map, `files_with_matches` to find where, `count` to size, `content` to see lines. Narrow a noisy pattern with `path`, `glob` or `type` instead of paging.

For a file above about 90 KB, read only the ranges your search hits point to, or follow its continuation lines when you need all of it. Do not read whole directories, generated files, lockfiles or vendored code.

Size only the paths the task needs from the sizes in the map, never a whole large repository; estimate one token per four bytes. When those paths plus the deliverable stay under about 150,000 tokens, or 100,000 on Composer, read everything yourself and write once. Otherwise read what fits and give the rest to `enot`: a full context triggers a slow compaction and rereading.

`enot` does not see your history. Its brief carries the question, the known paths, and the expected answer: facts with exact `file:line` and what stayed unresolved. Put all tasks of one wave in one `task` call. Results arrive on their own: keep working, call `wait` only when blocked, and never poll.

For a task that needs a whole system, such as a report, an audit or a migration, map the files with their sizes first, then read every relevant file in the fewest batches the output limits allow; leave out tests, generated files and vendored code only when the context cannot hold everything. Write a large deliverable in one pass after that reading; read and write part by part only when the material and the deliverable together would not fit in the free context.
