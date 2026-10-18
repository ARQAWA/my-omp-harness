Hand one extra, independent area of a broad codebase search to a read-only explorer on your model, with your reasoning level capped at medium. It searches in its own context and returns only the findings. The call returns at once with an id; the findings arrive later as a message starting with `[codebase_explorer#N]`.

You are the faster searcher: search the user's question yourself, in greedy parallel waves. Use an explorer only alongside your own search, for an area that is independent of the one you are searching and would cost you extra waves, such as a second subsystem, every caller of something across the codebase, or the deploy and run configuration. Launch it in the same response as your own first wave, and keep searching your part while it runs.

Never use it:
- for the whole question, or for the part the answer depends on most; never hand over the user's query and relay the answer;
- for a needle query (one class, function, string or config key), a known file, 2-3 files, or a quick question;
- when your own first wave already covers the area.

`question`: the exact area, the context it needs and exactly what to return; the explorer does not see the conversation. `thoroughness`: quick by default, medium when the area spans several naming conventions; very thorough only when the user asks for an exhaustive list.

Never search the area you handed over yourself. Trust the findings and use them as they are.
