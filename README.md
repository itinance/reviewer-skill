# reviewer-skill

A pull-request review process for [Claude Code](https://claude.com/claude-code): every PR
round gets **3 separate review agents**, each with one focus.

| Agent | Focus |
|---|---|
| `review-correctness` | Does the change do what the PR says; edge cases; every caller of a changed contract; error paths; spec grounding |
| `review-security` | Access control, input validation, secrets in logs, sensitive data, the project's hard rules, supply chain |
| `review-tests` | Red-first tests that pin real behaviour, the right test layer, the full CI job set on the head, spec/docs match the code |

The rules:

- All 3 reviewers run on every round, also for small diffs, docs, specs and dependency bumps.
- A re-round after a fix push goes to the **same named agents** (`SendMessage` with the new
  head sha). They check their own earlier findings and report only blocking problems. This
  stops endless nit loops.
- Reviewers only read. They write the full report to `.scratch/reviews/<pr>-<area>[-rN].md`
  and reply with the verdict only (CLEAN / FINDINGS, a count, the blocking titles).
- Findings are fixed **in the same PR**, also the non-blocking ones. Design questions go to
  the human.

## What gets installed

```
.claude/agents/review-correctness.md
.claude/agents/review-security.md
.claude/agents/review-tests.md
.claude/skills/review-round/SKILL.md   the orchestration: start, wait, fix, re-round, merge
docs/REVIEW_AND_MERGE.md               rules + a "Project gates" section with TODO(project) placeholders
CLAUDE.md                              optional "Review and merge" section (asked)
.gitignore                             optional ".scratch/" entry (asked)
```

The installer **never changes an existing file without asking**. For a file that exists with
different content it asks: skip (default), overwrite, or write a `.reviewer-skill.new` file
next to it. Without a terminal (for example when an agent runs it), it only creates missing
files and leaves every existing file alone. `--dry-run` shows what would happen.

## Install

The package has **no dependencies and no install scripts**. Install it with an exact version.
Never use `@latest`, a bare package name, or `-y` / `--yes`.

### 1. Check the release age first

Use a version that is at least **7 days** old (release cooldown). A fresh release is the
window in which a hijacked account or a bad publish does the most damage.

```sh
npm view reviewer-skill time --json      # publish date of every version
npm view reviewer-skill@0.1.0 dist.integrity
```

### 2. Run the installer in your project root

`--before <date>` lets npm enforce the cooldown: if the pinned version was published after
that date, npx stops with `notarget` before it downloads or runs anything.

```sh
# macOS
npx --ignore-scripts --before "$(date -v-7d +%Y-%m-%d)" reviewer-skill@0.1.0 install --dry-run
npx --ignore-scripts --before "$(date -v-7d +%Y-%m-%d)" reviewer-skill@0.1.0 install

# Linux
npx --ignore-scripts --before "$(date -d '7 days ago' +%Y-%m-%d)" reviewer-skill@0.1.0 install
```

`npx` asks "Ok to proceed?" before it downloads the package. Read it and answer it; do not
suppress it.

With Bun (Bun does not run lifecycle scripts of packages by default):

```sh
bunx reviewer-skill@0.1.0 install
```

Without the npm registry, from a git tag:

```sh
git clone --depth 1 --branch v0.1.0 https://github.com/itinance/reviewer-skill.git /tmp/reviewer-skill
git -C /tmp/reviewer-skill rev-parse HEAD     # compare with the commit of the v0.1.0 tag on GitHub
node /tmp/reviewer-skill/bin/reviewer-skill.js install --target .
```

Do not install it globally. If you must: `npm install -g --ignore-scripts reviewer-skill@0.1.0`.

### 3. After the install

1. Fill in the project gates: `grep -n "TODO(project)" docs/REVIEW_AND_MERGE.md`
   (test command, worktree install command, hard rules, sensitive-data check, release cooldown,
   optional review bot and merge checks).
2. Check that `.scratch/` is git-ignored: `git check-ignore -q .scratch/reviews/x.md && echo ok`.
3. Restart Claude Code (or open `/agents`) so that it loads the new agents.
4. Commit the files.

## Use

Ask Claude Code: *"Run a review round on PR 123."* The `review-round` skill starts the 3
agents in parallel as `review-123-correctness`, `review-123-security`, `review-123-tests`,
waits for their verdicts, reads the reports, fixes the findings in the same PR, and sends the
new head sha to the same 3 agents until all are clean.

## Commands

```
reviewer-skill [install] [--target <dir>] [--dry-run]
reviewer-skill print-snippet      print the CLAUDE.md section
reviewer-skill --help | --version
```

## Update

Run the installer again with the new exact version (after its cooldown). Files that you did not
change are reported as `unchanged` or are offered for overwrite; for files that you changed,
choose `n` and compare the `.reviewer-skill.new` file with your version.

## Development

```sh
npm test               # node --test, no dependencies
npm pack --dry-run     # check the package contents
```

## License

MIT
