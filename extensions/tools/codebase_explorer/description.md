Hand a broad codebase question to a fast read-only explorer (Haiku at medium effort, or gpt-6-luna at medium without Anthropic credentials). It runs many parallel searches in its own context and returns only the findings, so the search output stays out of yours. The call returns at once with an id; the findings arrive later as a message starting with `[codebase_explorer#N]`.

Use it when the answer needs broad search:
- a question that spans several areas or naming conventions, such as how a feature works across the codebase, every place that does X, or the codebase structure;
- several independent areas: launch one explorer per area in one response and search the rest yourself meanwhile.

Search directly instead:
- a needle query: one class, function, string or config key, such as where `ClientError` is defined;
- a known file path or 2-3 files: read them;
- a quick, simple question, which you answer faster yourself.

Do not hand over the whole user query and only relay the answer. `question`: the whole question, the context it needs and exactly what to return; the explorer does not see the conversation. `thoroughness`: quick for basic searches, medium for moderate exploration, very thorough for comprehensive analysis across many locations and naming conventions.

Never search what you handed to an explorer yourself: while it runs, do only other work, or end your response without tool calls. Trust the findings and use them as they are.
