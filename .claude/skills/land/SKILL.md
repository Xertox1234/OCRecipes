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
4. **Merge** — `gh pr merge <n> --squash --delete-branch`. Never in the same step as `gh pr create`. If the PR already has auto-merge armed (guard-eligible /todo PRs), don't merge manually — it lands itself.
5. **Sync** — `git pull --ff-only` on main. A burst of "new" commits arriving is normal fast-forward catch-up, not squash pollution.
6. **Branch sweep** — decision table below, then `git fetch --prune`.
7. **Reconcile** — verify the PR contained only the expected commits (`gh pr view <n> --json commits`); copy any todos archived inside worktrees into the main checkout's `todos/archive/`.

## The Review Gate

"Just merge it" means _land it without me_ — it is not permission to skip review. The user's deadline binds the user, not the work: they can leave; you review, then merge, autonomously. Only an explicit "skip the review" waives the gate — and then state plainly in your reply that it merged unreviewed. Security-labelled PRs never auto-merge and always get individual review.

| Rationalization                                                   | Reality                                                                                                                |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| "The user explicitly said merge; reviewing first would defy them" | They asked for the outcome (landed PR), not the shortcut. Review-then-merge delivers the outcome without them present. |
| "It's tiny / not auth / not IAP / not health data"                | Reviews here catch real bugs CI missed (PR #14: 4 findings incl. a race condition; PR #15: 2). Size doesn't exempt.    |
| "A revert is a one-liner if anything surfaces"                    | Merge auto-deploys to production. A bad merge is an incident, not a git command.                                       |
| "CI is green, so review is redundant"                             | CI runs the tests that exist. Review catches the bug no test covers.                                                   |

**Red flags — STOP and run the review:** you're about to type `gh pr merge` and no review verdict exists for the PR's current head; you're citing diff size, CI greenness, or the user's departure as the justification.

## Branch sweep

| Signal                                       | Meaning                                               | Action                                                                                                            |
| -------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| upstream `[gone]` in `git branch -vv`        | merged; origin auto-deleted the branch                | verify, then `git branch -D`. NEVER push/resurrect it — it's behind main and a PR from it diffs as a mass revert. |
| PR CLOSED without merge                      | rejection signal                                      | keep local AND remote; surface to the user, never sweep.                                                          |
| `git branch -d` refuses after a squash-merge | SHA-ancestry false alarm (squash rewrote the commits) | `git cherry main <branch>` — all `-` means the content landed → `-D` is safe.                                     |
| never pushed, unmerged                       | the only copy in existence                            | keep unless `git cherry` proves it landed.                                                                        |

Verification ladder, weakest → strongest: (1) `git cherry main <branch>` all `-` → (2) named squash commit on main (`git log --oneline main | grep '(#<pr>)'`) → (3) `git grep` shows the change live on main. Climb at least rung 1 before any `-D`; for safety-relevant code, climb all three.

## Common mistakes

- Concluding "no CI" or "CI stuck" from an empty commit-status response.
- Merging over a dirty tree, or blanket `git add -A` while the user works in parallel.
- Bulk-deleting branches without per-branch PR-state verification (`gh pr list --state all --json headRefName,state`).
- Treating post-merge fast-forward catch-up commits as evidence the squash swept extra content.
