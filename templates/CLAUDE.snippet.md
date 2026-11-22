## Review and merge

Every PR round gets 3 separate review agents: `review-correctness`, `review-security`, `review-tests` (`.claude/agents/`). This also applies to small diffs, docs, specs and dependency bumps. Run a round with the `review-round` skill. A re-round after a fix push goes to the same 3 named agents (`SendMessage`), not to new ones. Fix review findings in the same PR, never in a new PR. Merge only when all 3 are clean on the current head, with the project's merge method. The full rules and the project gates are in `docs/REVIEW_AND_MERGE.md`.
