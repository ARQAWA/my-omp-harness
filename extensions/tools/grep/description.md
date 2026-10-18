Search the workspace with ripgrep.

- Use this tool instead of shell rg; respects .gitignore
- Default scope is the workspace root; set path (absolute path) to narrow it
- Supply a regex pattern; escape metacharacters, e.g. "functionCall\(", "\{", "\}"
- Prefer type over broad glob; wildcard globs like * bypass ignore rules and slow searches
- Enable multiline only when a match spans lines—it can degrade performance
- Context flags (-A, -B, -C) only affect content output
- If results show "at least …", the output was truncated; tighten the query or raise head_limit
- Search greedily in waves, broad first, then narrower. First response: several broad grep searches in parallel in content mode without head_limit, one per facet of the subject, each putting every name, synonym and spelling into one alternation, plus glob for the deploy, run and entrypoint files (compose, Dockerfile, Makefile, systemd, CI, main, bin, __main__). Each next response, in one batch: read with read without offset or limit the files whose matching lines show a definition, configuration or entrypoint of the subject, and those run files; read other hits only around their matching lines with offset and limit; continue longer files from the returned line; and grep the exact identifiers just found. Stop when every part of the question has an answer backed by a file and line, covering every implementation, caller and config key of the subject itself; do not follow the subject into neighbouring subsystems the question does not ask about.
