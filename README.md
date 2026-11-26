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

| Template in this repo | Path in your project |
|---|---|
| `templates/agents/review-correctness.md` | `.claude/agents/review-correctness.md` |
| `templates/agents/review-security.md` | `.claude/agents/review-security.md` |
| `templates/agents/review-tests.md` | `.claude/agents/review-tests.md` |
| `templates/skills/review-round/SKILL.md` | `.claude/skills/review-round/SKILL.md` (start, wait, fix, re-round, merge) |
| `templates/docs/REVIEW_AND_MERGE.md` | `docs/REVIEW_AND_MERGE.md` (rules + section 4 "Project gates" to fill in) |
| `templates/CLAUDE.snippet.md` | optional: appended to `CLAUDE.md` between `<!-- reviewer-skill:start -->` and `<!-- reviewer-skill:end -->` |
| — | optional: a `.scratch/` line in `.gitignore` (the review reports) |

There are two ways to install: a Claude agent copies the files (no network code runs), or
the npm installer copies them. Both start in a feature branch.

## Install with a Claude agent (local, no npx)

This path runs no downloaded code. The agent only reads the templates and writes files.
Give your Claude Code session this section and the tag to use, for example: *"Install
reviewer-skill v0.3.2 as described in its README section 'Install with a Claude agent'."*

Steps for the agent:

1. **Branch first.** Run `git branch --show-current` and `git status --short`. Never install
   on the default branch. Create a branch or a worktree, for example
   `git switch -c chore/reviewer-skill`. Note every file that is already modified: those
   changes are not part of this install.
2. **Get the templates without running them.** Use a tag that is at least 7 days old
   (release cooldown):
   ```sh
   git clone --depth 1 --branch v0.3.2 https://github.com/itinance/reviewer-skill.git /tmp/reviewer-skill-v0.3.2
   git -C /tmp/reviewer-skill-v0.3.2 log -1 --format='%H %cI'   # tag commit and date; compare with the tag on GitHub
   ```
   Do not run anything from the clone. Read the files only.
3. **Copy the 5 files** in the table above with Read and Write. If a destination exists
   with other content, do not overwrite it: show the human the difference and ask.
4. **CLAUDE.md and .gitignore.** If `CLAUDE.md` does not contain
   `<!-- reviewer-skill:start -->`, append the text of `templates/CLAUDE.snippet.md` between
   the start and end markers. If no `.gitignore` line ignores `.scratch/`, add `.scratch/`.
   Check with `git check-ignore -q .scratch/reviews/x.md`.
5. **Fill in section 4 of `docs/REVIEW_AND_MERGE.md` from repo facts only.** Write the
   source file after each value. The section says what to read for each gate. In short:
   - Test and lint: the task runner (Justfile, Makefile, package.json scripts) and the CI
     workflows (`.github/workflows/*.yml`, job names). Prefer the project's safe test
     wrapper (for example one with a throwaway database). Copy forbidden commands from
     CLAUDE.md into the gate.
   - Local run when CI cannot answer: the install and test command for a throwaway
     worktree in the real layout, or "none; reviewers use CI only". Reviewers read CI first.
   - Merge method and where decisions are recorded: copy them from CLAUDE.md (for example
     "merge commit; the base is merged into the branch by hand").
   - Supply chain: `.npmrc` (`ignore-scripts`), `pnpm-workspace.yaml` (`minimumReleaseAge`,
     `onlyBuiltDependencies`, `ignoredBuiltDependencies`), `bunfig.toml`, the uv/pip config
     (`exclude-newer`). If no setting enforces a cooldown, write "not enforced by config;
     the security reviewer checks publish dates".
   - Hard rules: grep the tests for existing guard tests and name the file and the test
     functions. A rule without a guard test: "no guard test yet". Never invent one.
   - Human-approval paths: find the real directories (for example
     `find . -type d -name versions` for migrations). Do not assume a framework default.
   - AI review bot: copy the project's existing rules from CLAUDE.md, and name removed bots.
   - Sensitive data: list the classes only (customer names, personal emails, live database
     rows, `.env` contents). Never write a real value. If there is no check script, say so.
6. **Verify section 4 is complete.** This prints `0` when every gate is filled in:
   ```sh
   sed -n '/^## 4\./,/^## 5\./p' docs/REVIEW_AND_MERGE.md | grep -c 'TODO(project)'
   ```
7. **Commit only the install.** Stage the installed files, `CLAUDE.md` and `.gitignore` by
   name (never `git add -A`). For any other change in the checkout, ask the human, or put it
   in a separate commit.
8. **Open a draft PR** and make it the first review round of the new process. The new agent
   types load only after a restart of Claude Code or `/agents`. In the same session, start
   each reviewer with `subagent_type: "general-purpose"` and the full text of its agent file
   in the prompt.
9. **Clean up:** `rm -rf /tmp/reviewer-skill-v0.3.2`.

**If the files were already written on the default branch** (for example by an older
installer): create the branch or worktree, copy the installed files there, apply the
`CLAUDE.md` and `.gitignore` changes there, and check that the files are the same
(`diff -r`). Then, on the default branch, delete the new files and run
`git restore CLAUDE.md .gitignore`. Leave unrelated changes alone.

## Install with npm

The package has **no dependencies and no install scripts**. Install it with an exact version.
Never use `@latest`, a bare package name, or `-y` / `--yes`. `npx` downloads and runs code:
if your rules forbid fetch-and-execute, use the agent path above.

### 1. Check the release age first

Use a version that is at least **7 days** old (release cooldown). A fresh release is the
window in which a hijacked account or a bad publish does the most damage.

```sh
npm view reviewer-skill time --json      # publish date of every version
npm view reviewer-skill@0.3.2 dist.integrity
```

### 2. Run the installer in a feature branch of your project

The installer refuses to write on the default branch (`origin/HEAD`, else `main` or
`master`). It reads the branch with your local `git`; that is the only program it runs.
Create a branch first: `git switch -c chore/reviewer-skill`.

`--before <date>` lets npm enforce the cooldown: if the pinned version was published after
that date, npx stops with `notarget` before it downloads or runs anything. This also means
that a new release cannot be installed with this command during its first 7 days. That is the
cooldown working, not a broken release.

```sh
# macOS
npx --ignore-scripts --before "$(date -v-7d +%Y-%m-%d)" reviewer-skill@0.3.2 install --dry-run
npx --ignore-scripts --before "$(date -v-7d +%Y-%m-%d)" reviewer-skill@0.3.2 install

# Linux
npx --ignore-scripts --before "$(date -d '7 days ago' +%Y-%m-%d)" reviewer-skill@0.3.2 install
```

`npx` asks "Ok to proceed?" before it downloads the package. Read it and answer it; do not
suppress it.

In a terminal, the installer asks before each change to an existing file and before the
optional `CLAUDE.md` and `.gitignore` edits. Without a terminal (an agent runs it), it only
creates missing files. An agent names the optional edits explicitly:

```sh
npx --ignore-scripts --before "$(date -v-7d +%Y-%m-%d)" reviewer-skill@0.3.2 install --append-claude-md --gitignore-scratch
```

Both edits are idempotent: the `CLAUDE.md` section is added once (marker check), and the
`.scratch/` line only if no line ignores `.scratch` yet. There is no flag that answers every
question with yes.

With Bun (Bun does not run lifecycle scripts of packages by default):

```sh
bunx reviewer-skill@0.3.2 install
```

Do not install it globally. If you must: `npm install -g --ignore-scripts reviewer-skill@0.3.2`.

### 3. After the install

Follow steps 5 to 8 of the agent path: fill in section 4 from repo facts, verify it, commit
only the installed files, open a draft PR as the first review round, and restart Claude Code
(or open `/agents`) so that it loads the new agents.

## Use

### Find the skill

In Claude Code the skill is called **`review-round`**. `reviewer-skill` is only the name of
the npm package and this repo. The skill is installed per project, not globally:

- `.claude/skills/review-round/SKILL.md` is the skill.
- `.claude/agents/review-correctness.md`, `review-security.md` and `review-tests.md` are the
  3 reviewers.

Start a new Claude Code session in the project. A session that was already running during the
install may not know the skill or the agents yet. Then:

- Type `/review-round` (it shows up in the autocomplete after `/rev`), or ask for a
  review: the skill's description makes Claude load it for review requests.
- Open `/agents` to see the 3 reviewers.

If the skill does not show up, check that `.claude/skills/review-round/SKILL.md` exists in
the project root. If it is missing, the install did not run (for example npx stopped with
`notarget`, see the cooldown above).

### Run a review round

Ask Claude Code: *"Run a review round on PR 123."* The `review-round` skill starts the 3
agents in parallel as `review-123-correctness`, `review-123-security`, `review-123-tests`,
waits for their verdicts, reads the reports, fixes the findings in the same PR, and sends the
new head sha to the same 3 agents until all are clean.

## Commands

```
reviewer-skill [install] [options]
  --target <dir>           project root (default: current directory)
  --dry-run                show what would happen; write nothing
  --append-claude-md       append the marked review section to CLAUDE.md (once)
  --gitignore-scratch      add ".scratch/" to .gitignore (once)
  --allow-default-branch   install on the default branch (normally refused)
reviewer-skill print-snippet      print the CLAUDE.md section
reviewer-skill --help | --version
```

## Update

Run the installer again with the new exact version (after its cooldown), or repeat the agent
path with the new tag. A file that differs from the new template is never overwritten without
asking; choose `n` to get a `.reviewer-skill.new` file and compare it with your version.

## Development

```sh
npm test               # node --test, no dependencies
npm pack --dry-run     # check the package contents
```

## License

MIT
