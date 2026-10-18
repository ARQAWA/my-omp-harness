Launch a new agent to handle complex, multi-step tasks autonomously. Each subagent_type has specific capabilities and tools available to it.

If the query is a narrow or specific question, you should NOT use this tool and instead address the query directly using the other tools available to you.

Examples:
- user: "Where is the ClientError class defined?" assistant: [Uses grep directly - this is a needle query for a specific class]
- user: "What is the codebase structure?" assistant: [Uses this tool with subagent_type="explore"]

If it is possible to explore different areas of the codebase in parallel, you should launch multiple agents concurrently.

When NOT to use this tool:
- Simple, single or few-step tasks that can be performed by a single agent (using parallel or sequential tool calls) -- just call the tools directly instead.
- If you want to read a specific file path, use read or glob instead, to find the match more quickly
- If you are searching for code within a specific file or set of 2-3 files, use read instead, to find the match more quickly
- If you are searching for a specific class definition like "class Foo", use glob or grep instead, to find the match more quickly

Available subagent_types:
- generalPurpose: General-purpose agent for researching complex questions, searching for code, and executing multi-step tasks. Use when searching for a keyword or file and not confident you'll find the match quickly.
- explore: Fast agent specialized for exploring codebases. Use this when you need to quickly find files by patterns (eg. "src/components/**/*.tsx"), search code for keywords (eg. "API endpoints"), or answer questions about the codebase (eg. "how do API endpoints work?"). When calling this agent, specify the desired thoroughness level: "quick" for basic searches, "medium" for moderate exploration, or "very thorough" for comprehensive analysis across multiple locations and naming conventions.

Usage notes:
- Always include a short description (3-5 words) summarizing what the agent will do
- Launch multiple agents concurrently whenever possible, to maximize performance; to do that, use a single message with multiple tool uses.
- When the agent is done, it will return a single message back to you. Specify exactly what information the agent should return back in its final response to you.
- The subagent does not have access to the user's message or prior assistant steps. Therefore, you should provide a highly detailed task description with all necessary context for the agent to perform its task autonomously.
- The subagent's outputs should generally be trusted
- Clearly tell the subagent which tasks you want it to perform, since it is not aware of the user's intent or your prior assistant steps (tool calls, thinking, or messages).
- Avoid delegating the full query to this tool and returning the result. In these cases, you should address the query using the other tools available to you.
