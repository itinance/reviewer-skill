---
name: review-round
description: Use when a pull request needs a review, when a fix was pushed to a PR that is under review, when a reviewer reported findings, or before merging a PR. Covers code, spec, docs and dependency-bump PRs of any size.
---

# Review round

Every PR round gets 3 separate review agents: `review-correctness`, `review-security`,
`review-tests` (`.claude/agents/`). The project rules are in `docs/REVIEW_AND_MERGE.md`;
read it first. Its section 4 holds the project gates.

You are the orchestrator. You start the reviewers, relay, fix, and re-round. You do not
review the PR yourself, and you do not edit code while reviewers run.

## Before round 1

1. Get the PR number, the head sha and the base branch:
   `gh pr view <pr> --json number,headRefOid,baseRefName,isCrossRepository,title,body`.
2. Check that the reports stay out of git: `git check-ignore -q .scratch/reviews/x.md`.
   If this fails, stop and ask the human to add `.scratch/` to `.gitignore`.
3. Write one line that says what the PR claims to do (from its title and body).

## Round 1: start all 3 in one message

Send ONE message with 3 `Agent` calls, so that they run in parallel. Run each in the
background (`run_in_background: true` where the tool has it). The `name` makes the agent
addressable for later rounds.

```
Agent(
  name: "review-<pr>-correctness",
  subagent_type: "review-correctness",
  description: "Review PR <pr> correctness",
  prompt: "PR <pr>, head <sha>, base <base>. Claims: <one line>. Round 1.
           Report to .scratch/reviews/<pr>-correctness.md."
)
```

Do the same for `review-<pr>-security` / `review-security` and `review-<pr>-tests` /
`review-tests`. If the agent types are not loaded (the files were installed during this
session), use `subagent_type: "general-purpose"` and put the full text of the agent file
in the prompt.

## Wait, then read

- Wait until all 3 have replied. Each background agent sends a completion notification by
  itself: do not poll, do not sleep. Do not edit while you wait.
- A reply is only: CLEAN or FINDINGS, a count, and the titles of blocking findings. Read
  the full reports in `.scratch/reviews/` before you fix anything.

## Fix

- Fix every finding in THIS PR, also the non-blocking ones. Never open a new PR for a
  review finding.
- A finding that needs a design decision goes to the human. Do not decide it. Fix and push
  the other findings as usual. The PR does not merge before the human has answered and the
  answer is applied. Record the answer in the spec's decisions table (source, date), and put
  it in the next round message.
- A real bug outside the PR's scope gets its own small PR from the base branch.
- Push all fixes of the round as one push. Get the new head sha.

## Round N (N ≥ 2): the SAME agents, by message

Send the new sha to the same 3 named agents with `SendMessage`. Do not start new agents.
Each one checks its own earlier findings. If `SendMessage` is a deferred tool, load it
first (`ToolSearch` with `select:SendMessage`).

```
SendMessage(
  to: "review-<pr>-correctness",
  message: "Round <N> of PR <pr> (base <base>). New head <sha>.
            Changed since round <N-1>: <files>. Decisions since then: <none | text>.
            Check your earlier findings, check only the changed text, report only
            blocking problems. Report to .scratch/reviews/<pr>-correctness-r<N>.md."
)
```

Re-rounds report only blocking problems; this stops nit loops. A re-round with no blocking
problem is CLEAN.

If a named agent can no longer be reached (for example after a session restart), start a
new agent with the same name and type, and tell it to read its earlier reports in
`.scratch/reviews/<pr>-<area>*.md` first.

Repeat fix → re-round until all 3 are CLEAN on the current head.

## Merge

Only when all 3 are CLEAN on the current head, in this order (`docs/REVIEW_AND_MERGE.md`
sections 3 and 4):

1. If the head is behind the base: `gh pr update-branch <pr>`, then send the new sha to the
   3 agents as a new round. Start again at "Wait, then read".
2. Run each gate of section 4 as its own command and read its result. A gate that still
   says `TODO(project)` does not exist; say so in your report to the human.
3. In a separate command: `gh pr merge <pr> --merge --match-head-commit <sha>`. Never
   squash.
4. Check that CI on the base branch is green after the merge.

## When the human asks to skip a step

The rules above are the human's own process, so the human may change them for one PR. Say
in one sentence which rule the request breaks (for example "all 3 reviewers also on small
PRs"). Do it only after the human confirms, and write the exception in the PR body.

## Quick reference

| Situation | Action |
|---|---|
| New PR, or first review | 3 `Agent` calls in one message, names `review-<pr>-<area>` |
| Fix pushed | `SendMessage` the new sha to the same 3 names |
| Small diff, docs or spec PR | Still all 3 reviewers |
| Reviewer reports a non-blocking finding | Fix it in this PR |
| Finding needs a design choice | Ask the human |
| Head behind base | `gh pr update-branch <pr>`, then the reviewers check CI on the new head |
| PR from a fork | Reviewers only read; nobody runs its code |

## Common mistakes

- Starting 3 NEW agents for round 2. They do not know their earlier findings, and they
  report new nits forever. Re-rounds go to the same names.
- Reviewing only the "risky" lane on a small PR. Every round runs all 3.
- Opening a follow-up PR for a finding. Fix it in this PR.
- Asking a reviewer for its findings in the chat. The reply is the verdict; the findings are
  in the report file.
- Merging on a green CI that shows only skipped checks right after a push. Wait for the run.
