Blind review by a separate model: it checks the work against the user's agreement and returns `CLEAN` or every finding with verbatim quotes. The call returns at once with an id; the verdict arrives later as a message starting with `[review#N]`. Keep working meanwhile; do not wait or poll.

- `level`: light for small work, blind for large work, high when the user asks for it. The user's commands /light-review, /blind-review and /high-review ask for these levels.
- `agreement`: the user's request, amendments, answers and accepted proposals, verbatim. `object`: the paths of the changed files, the diff or the command that shows it, and the stage. `criterion`: what the check confirms. `rejected`: findings you rejected earlier, with their reasons.
- Fix every admitted finding; reject one only with a reason backed by a verbatim quote.
