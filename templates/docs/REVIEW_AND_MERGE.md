# Review and merge

These rules apply to every pull request, also to small diffs, docs, specs and dependency
bumps. They add to `CLAUDE.md` and do not repeat it.

Installed by `reviewer-skill`. Section 4 holds the project gates. Each open gate carries a
TODO marker. Fill in every gate from facts in this repository, and name the file that each
fact comes from. A gate that is still open does not exist yet: reviewers report it as a
note, they do not invent one.

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

<!--
Replace each open marker with a fact from this repository and its source, for example
"`make test` (source: Makefile, .github/workflows/ci.yml job `test`)". A line that does not
apply: write "none". Never write a guess, and never write a real sensitive value.
-->

### 4.1 Commands

Read the task runner (Justfile, Makefile, package.json scripts), the CI workflows
(`.github/workflows/*.yml`, job names) and CLAUDE.md first.

- Test command: TODO(project). Use the project's safe wrapper (for example one that uses
  a throwaway database), not a raw `pytest` or `npm test`, if the project has one.
- Forbidden commands: TODO(project), for example "plain `pytest` hits the live database"
  (source: CLAUDE.md), or "none".
- Lint and type check: TODO(project).
- Dependency install in a throwaway review worktree, from the lockfile, with install
  scripts off, for the real layout: TODO(project). Examples: `npm ci --ignore-scripts`;
  `pnpm install --frozen-lockfile --ignore-scripts` (add `--ignore-workspace` for a
  standalone app inside a workspace); `uv sync --frozen`.
- CI workflow and job set to compare job counts against: TODO(project).

### 4.2 Hard rules

- Rules that a PR must never weaken, each with its guard test (file and test function):
  TODO(project). Find the guard tests with a grep over the tests. A rule without a guard
  test: write "no guard test yet". Do not invent a test.

### 4.3 Sensitive data

- Classes of sensitive data in this project: TODO(project), for example customer names,
  personal emails, live database rows, `.env` contents. Classes only: never a real value.
- Sensitive-data check on the diff, the commit messages and the PR body: TODO(project).
  If the project has no such script, write "none; reviewers report file:line and counts
  only". A check must print counts only, never the matched text.

### 4.4 Supply chain

Read `.npmrc`, `pnpm-workspace.yaml` (`minimumReleaseAge`, `onlyBuiltDependencies`,
`ignoredBuiltDependencies`), `bunfig.toml` and the uv/pip config (`exclude-newer`).

- Exact version pins: TODO(project).
- Release cooldown per ecosystem (at least 7 days): TODO(project). Write the setting that
  enforces it. If no config enforces it, write "not enforced by config; the security
  reviewer checks publish dates". Never claim a cooldown that no config enforces.
- Install scripts: TODO(project), for example "off (`ignore-scripts=true` in .npmrc);
  allowed only for the packages in `onlyBuiltDependencies`".

### 4.5 Extra merge gates

- AI review bot: TODO(project). Copy the project's own rules for it (CLAUDE.md), for
  example "manual trigger only, backend PRs only", and name bots that were removed; or
  "none". If a bot is used: keep it paused until the 3 reviewers are clean, then trigger it
  once. A pause posted right after `gh pr create` does not stop the first review: open the
  PR as a draft, pause the bot, wait for its confirmation, then mark the PR ready.
- Checks before a merge (for example "no live deploy running"): TODO(project) or "none".
- Paths or PR types that need a human approval: TODO(project) or "none". Use the real
  paths (find them, for example `find . -type d -name versions` for migrations); do not
  assume a framework's default layout.

## 5. Decisions

- Every human decision on a PR goes into the decisions table of its spec, with the source and
  the date, in the same turn.
