Hand an independent area of a broad codebase search to a read-only explorer on your model, with your reasoning level capped at medium. It searches in its own context and returns only the findings. The call blocks until the explorer finishes and returns its findings as the result.

For a broad question that spans several independent areas, such as separate subsystems, every caller of something across the codebase, or the deploy and run configuration, call several explorers in one response, one per area; they run in parallel, and you get all findings together when the last one finishes. Then continue yourself: check what the answer depends on most, search what the findings leave open, and write the answer.

Never use it:
- for a needle query (one class, function, string or config key), a known file, 2-3 files, or a quick question; search those yourself;
- for an area your own search already covers.

`question`: the exact area, the context it needs and exactly what to return; the explorer does not see the conversation. `thoroughness`: quick by default, medium when the area spans several naming conventions; very thorough only when the user asks for an exhaustive list.

Do not search an area again that an explorer already covered; trust its findings and use them as they are.
