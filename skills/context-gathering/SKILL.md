---
name: context-gathering
description: "Fixed cycle for gathering code context fast: map, one wide rg search, whole-file batch reads, stop."
hide: true
---

# Context gathering

Gather context in a few wide rounds, not many narrow ones. Each round is one response with every independent call in it. Between rounds, reason only about the next batch: do not retell what you read.

Scale to the task. When the task names its paths or is a small change in a known place, read those files at once and skip the map. Otherwise:

1. **Round 1.** In one response:
   - Map the task root with line counts: bash `git ls-files | xargs wc -l`, capped by `head`. If the cap cuts the list, map directories first and expand the relevant ones in round 2. Without bash, or outside a git root, use `glob`.
   - Open the entry documents (README, AGENTS.md, manifests).
   - Run `rg` with `output_mode: files_with_matches` and one alternation of 10-30 task terms: identifiers, synonyms, singular and plural forms, every naming style in use, config keys, routes, messages.
   - Read the files the task already names.
2. **Round 2.** In one response:
   - Read every relevant file whole with a bare `read`, as parallel calls. A bare `read` returns the whole file.
   - Run `rg` content searches with alternations, limited to the chosen scope, for definitions, callers, configuration and tests.
3. **Round 3.** Only targeted `rg` follow-ups with exact names found so far, batched with the reads they imply. Then stop gathering and act. A fourth round needs a concrete missing fact.

`rg` takes `path`, `glob`, `type`, `-i`, `-A`/`-B`/`-C`, `head_limit`, `offset` and `multiline`. Its output is grouped per file and capped by `head_limit`; the footer names the next `offset`. Use `files_with_matches` to find where, `count` to size, `content` to see lines. Narrow a noisy pattern with `path`, `glob` or `type` instead of paging.

Use ranged reads only for files above about 100 KB, guided by `rg` hits. Do not read whole directories, generated files, lockfiles or vendored code.

Without `rg` among your tools (restricted children such as plan-mode tasks), use `grep` with `|` alternation in one pattern and narrowed `;`-separated paths, page with `skip` (20 files per page), and use `glob` for the map.

Size only the paths the task needs with `wc -c`, never a whole large repository; estimate one token per four bytes. When those paths plus the deliverable stay under about 150,000 tokens, or 100,000 on Composer, read everything yourself and write once. Otherwise read what fits and give the rest to `enot`: a full context triggers a slow compaction and rereading.

`enot` does not see your history. Its brief carries the question, the known paths, and the expected answer: facts with exact `file:line` and what stayed unresolved. Put all tasks of one wave in one `task` call. Results arrive on their own: keep working, call `wait` only when blocked, and never poll.

For a task that needs a whole system, such as a report, an audit or a migration, list files with sizes first, then read every relevant file whole in the fewest batches the output limits allow; leave out tests, generated files and vendored code only when the context cannot hold everything. Write a large deliverable in one pass after that reading; read and write part by part only when the material and the deliverable together would not fit in the free context.
