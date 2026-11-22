# Review and merge

These rules apply to every pull request, also to small diffs, docs, specs and dependency
bumps. They add to `CLAUDE.md` and do not repeat it.

Installed by `reviewer-skill`. Fill in every `TODO(project)` in section 4. Find them with
`grep -n "TODO(project)" docs/REVIEW_AND_MERGE.md`. A gate that still says `TODO(project)`
does not exist yet: reviewers report it as a note, they do not invent one.

## 1. Three separate reviewers per round

- Every review round starts 3 separate review agents on the PR head:
  - `review-correctness` (`.claude/agents/review-correctness.md`)
  - `review-security` (`.claude/agents/review-security.md`)
  - `review-tests` (`.claude/agents/review-tests.md`)
- The `review-round` skill (`.claude/skills/review-round/SKILL.md`) runs a round.
- Each agent gets a name with the PR number and its area, for example `review-123-security`.
  All 3 start in one message, in the background, so that they run in parallel.
- The reviewers only read. They never check out a branch in a checkout that another session
  uses. They never edit, never comment on GitHub, never merge.
- "Read only" is a rule in the agent prompt, not a tool limit. The agents need `Write` for
  the report file, and `Bash` can write anywhere.
- The reviewers may run PR code only in a throwaway worktree under `.claude/worktrees/`, and
  only when the PR head is in this repository. For a PR from a fork
  (`gh pr view <pr> --json isCrossRepository` is `true`), they only read.
- Each reviewer writes its full report to `.scratch/reviews/<pr>-<area>[-rN].md`
  (git-ignored) and replies with only: the verdict (CLEAN or FINDINGS), the number of
  findings, and a one-line title for each blocking finding.
- Each finding has: file:line, a concrete failure scenario, a fix direction, blocking yes/no.
- After a fix push, the new head sha goes to the SAME three agents (`SendMessage`). Each one
  checks its own earlier findings, checks only the changed text, and reports only blocking
  problems. Repeat until all three are clean on the current head.
- The orchestrator (the main session) only relays while reviewers run. It does not edit code
  until all three have replied.

## 2. Findings are fixed in the same PR

- Fix every review finding in the PR that it was found in, also the non-blocking ones. Never
  open a new PR for a review finding, also not for the same class of problem in another file.
- Push the fixes for one round as one push.
- A finding that needs a design decision goes to the human. The agent does not decide it.
- A real bug found outside the scope of the PR gets its own small PR from the base branch.

## 3. Merge

- Merge only when all 3 reviewers are CLEAN on the current head, and every gate in
  section 4 is green.
- Never start a merge in the same command as a safety check. Run the check on its own and
  read its result first.
- Merge with `gh pr merge <pr> --merge --match-head-commit <sha>`. Never squash. Never
  rebase a PR branch.
- Never merge the base branch into a work branch. When the head is behind, the merge step
  runs `gh pr update-branch <pr>`, and the reviewers check CI again on the new head.
- After the merge: CI on the base branch is green.

## 4. Project gates

<!-- Fill in each TODO(project). Delete a line that does not apply, and write "none". -->

### 4.1 Commands

- Test command: TODO(project), for example `npm test` or `uv run pytest`.
- Lint and type check: TODO(project).
- Dependency install in a throwaway review worktree, from the lockfile, with install
  scripts off: TODO(project), for example `npm ci --ignore-scripts`.
- CI workflow to compare job counts against: TODO(project), for example `ci.yml`.

### 4.2 Hard rules

- Rules that a PR must never weaken, with their guard tests: TODO(project), for example
  "the app never sends email to end users (`tests/test_no_outbound_email.py`)".

### 4.3 Sensitive data

- What counts as sensitive in this project: TODO(project), for example customer data,
  personal data, production ids.
- Sensitive-data check on the diff, the commit messages and the PR body: TODO(project) or
  "none". The check must print counts only, never the matched text.

### 4.4 Supply chain

- Exact version pins: TODO(project), for example "all direct dependencies".
- Release cooldown per ecosystem (at least 7 days): TODO(project), for example "npm 7 days,
  PyPI 7 days".
- Install scripts: off (`ignore-scripts=true`) unless a package is listed here:
  TODO(project).

### 4.5 Extra merge gates

- AI review bot (optional): TODO(project) or "none". If used: keep it paused until the 3
  reviewers are clean, then trigger it once. A pause posted right after `gh pr create` does
  not stop the first review: open the PR as a draft, pause the bot, wait for its
  confirmation, then mark the PR ready.
- Checks before a merge (for example "no live deploy running"): TODO(project) or "none".
- Paths or PR types that need a human approval: TODO(project) or "none".

## 5. Decisions

- Every human decision on a PR goes into the decisions table of its spec, with the source and
  the date, in the same turn.
