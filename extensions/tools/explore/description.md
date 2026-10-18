Hand a codebase question to a read-only explorer on your model at medium effort. The call returns at once with an id; the findings arrive later as a message starting with `[explore#N]`. Keep working meanwhile; do not wait or poll.

- Use it for broad questions that span several areas: launch several explorers in one response, one per independent area, and search the rest yourself. For a needle query, such as one class or one file, search directly.
- `question`: the whole question with its context and what to return; the explorer does not see the conversation. `thoroughness`: quick, medium or very thorough.
- Trust the findings and use them as they are.
