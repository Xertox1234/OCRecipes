---
name: land
description: Use when merging a pull request, deciding whether a PR is ready to merge, or cleaning up local/remote branches after merges — especially when told to "just merge it" under time pressure, when a diff seems too small to review, when CI status looks empty or stuck, or when `git branch -d` refuses to delete a branch.
---

# Land — merging PRs and cleaning up after them

## Overview

Merging is the irreversible step: squash-merge to protected `main` auto-deploys to Railway, and un-merging after a deploy is never one line. The ritual below is cheap; skipping a step is how parallel edits get swept into squashes, unreviewed bugs ship, and unmerged work gets deleted.

**Violating the letter of this ritual is violating its spirit.**

## The Ritual (in order)

1. **Review gate** — see below. No merge without a review verdict on the PR's final commits.
2. **Clean tree** — `git status --porcelain`. Anything dirty that isn't this PR's work: `git stash push -m "..." -- <paths>` before the merge, `git stash pop` after. A dirty tree at `gh pr merge --squash` sweeps the user's parallel IDE edits into the squash commit (PR #320 incident).
3. **CI truth** — `gh pr checks <n>` or the Checks-API MCP surfaces. The legacy commit-status API returns `total_count: 0` on this repo even when CI is fully green — an empty status response is a measurement artifact, never evidence of anything.
4. **Merge** — this project requires a **human** to run the actual merge. Once the review gate passes, the tree is clean, and CI is green: push if not already pushed, report the review verdict, and **stop** — ask the user to run `gh pr merge <n> --squash --delete-branch` themselves. The one exception is a guard-eligible `/todo` PR with auto-merge already armed via `gh pr merge --auto` (see `scripts/todo-automerge-guard.sh`) — that lands itself once CI passes, no human step needed. This wording is the actual fix (incident: PR #626, 2026-07-14 — this skill's own prior wording told the agent to merge autonomously, and it did, unreviewed by a human). There is no PreToolUse hook backing this policy (`.claude/hooks/merge-approval-guard.sh` was removed 2026-07-15, by explicit user request) — the wording here is the only enforcement. Never run a merge in the same step as `gh pr create`, regardless.
5. **Sync** — `git pull --ff-only` on main. A burst of "new" commits arriving is normal fast-forward catch-up, not squash pollution.
6. **Branch sweep** — decision table below, then `git fetch --prune`.
7. **Reconcile** — verify the PR contained only the expected commits (`gh pr view <n> --json commits`); copy any todos archived inside worktrees into the main checkout's `todos/archive/`.

## The Review Gate

"Just merge it" means _land it without me_ — it is not permission to skip review, and it is not permission to execute the merge yourself. The user's deadline binds the user, not the work: they can leave; you review, fix, and push — then **stop** and hand the actual merge to them (see step 4; the only autonomous-merge path is a guard-eligible `/todo` PR with auto-merge already armed). Only an explicit "skip the review" waives the review gate itself — it never authorizes an agent-executed merge outside that one carve-out. If review is explicitly skipped, state plainly in your reply that it merged unreviewed. Security-labelled PRs never auto-merge and always get individual review.

| Rationalization                                                   | Reality                                                                                                                |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| "The user explicitly said merge; reviewing first would defy them" | They asked for the outcome (landed PR), not the shortcut. Review-then-merge delivers the outcome without them present. |
| "It's tiny / not auth / not IAP / not health data"                | Reviews here catch real bugs CI missed (PR #14: 4 findings incl. a race condition; PR #15: 2). Size doesn't exempt.    |
| "A revert is a one-liner if anything surfaces"                    | Merge auto-deploys to production. A bad merge is an incident, not a git command.                                       |
| "CI is green, so review is redundant"                             | CI runs the tests that exist. Review catches the bug no test covers.                                                   |

**Red flags — STOP:** you're about to type `gh pr merge` and no review verdict exists for the PR's current head; you're citing diff size, CI greenness, or the user's departure as the justification; you're about to run `gh pr merge` or `mcp__github__merge_pull_request` yourself on anything other than a guard-eligible `/todo` PR with auto-merge armed — that decision is the human's, not yours.

## Branch sweep

| Signal                                       | Meaning                                               | Action                                                                                                            |
| -------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| upstream `[gone]` in `git branch -vv`        | merged; origin auto-deleted the branch                | verify, then `git branch -D`. NEVER push/resurrect it — it's behind main and a PR from it diffs as a mass revert. |
| PR CLOSED without merge                      | rejection signal                                      | keep local AND remote; surface to the user, never sweep.                                                          |
| `git branch -d` refuses after a squash-merge | SHA-ancestry false alarm (squash rewrote the commits) | `git cherry main <branch>` — all `-` means the content landed → `-D` is safe.                                     |
| never pushed, unmerged                       | the only copy in existence                            | keep unless `git cherry` proves it landed.                                                                        |

Verification ladder, weakest → strongest: (1) `git cherry main <branch>` all `-` → (2) named squash commit on main (`git log --oneline main | grep '(#<pr>)'`) → (3) `git grep` shows the change live on main. Climb at least rung 1 before any `-D`; for safety-relevant code, climb all three.

**Rung 1 doesn't apply to a branch with multiple commits squashed together.** `git cherry` compares per-commit patch-ids; a squash that combines N pre-existing commits (e.g. a `-B <local>` branch created from a remote PR head, then one more commit added on top) into ONE commit on `main` gives every individual commit a patch-id that matches nothing — `git cherry` reports all of them `+` (not found), never `-`, even though the content fully landed. This isn't the "false alarm" `-`-when-you-expected-`+` case the ladder above describes — it's the opposite surface (all `+`) on a genuinely-landed branch, and it's easy to misread as "nothing landed, don't delete." When a branch has more than one commit relative to its point of divergence from `main`, skip straight to rung 2 or 3.

## Common mistakes

- Concluding "no CI" or "CI stuck" from an empty commit-status response.
- Merging over a dirty tree, or blanket `git add -A` while the user works in parallel.
- Bulk-deleting branches without per-branch PR-state verification (`gh pr list --state all --json headRefName,state`).
- Treating post-merge fast-forward catch-up commits as evidence the squash swept extra content.
- Executing the merge yourself (`gh pr merge` or `mcp__github__merge_pull_request`) for anything other than a guard-eligible `/todo` PR with auto-merge armed — that decision belongs to the human (PR #626 incident, 2026-07-14: this skill's own earlier wording said "review, then merge, autonomously," and got followed literally).
