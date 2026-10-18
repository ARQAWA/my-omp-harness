Structural code search via ast-grep: matches syntax, not text.

- Use ast_grep instead of grep when the match depends on code structure: a construct inside another (a blocking call inside `async def`, an `except` whose body is only `pass`), calls with a given argument shape, declarations of one kind. It returns exact matches with no hits in comments or strings, so one call replaces a grep followed by reading every hit.
- Run several ast_grep calls in one response, one per pattern or language, together with your grep wave.
- `pat` is one AST pattern for one language; set `lang` when the extension is ambiguous. `$NAME` captures one node, `$_` matches one node without binding, `$$$NAME` and `$$$` match zero or more. Names are uppercase and cover a whole node; `prefix$VAR` fails. The same metavariable twice must match identical code.
- A pattern must parse as one node; wrap a fragment: `class $_ { ... }`. Python examples: `async def $F($$$ARGS): $$$BODY`, `except $E: pass`, `time.sleep($$$)`. Rust: `$X.unwrap()`, `fn $NAME($$$ARGS) -> Result<$T> { $$$ }`.
- Narrow `path` to a directory or glob; pass several as `"src; tests"`. A parse error means the pattern is wrong, not that nothing matches.
- `skip` pages through long results.
