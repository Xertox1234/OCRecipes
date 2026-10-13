---
title: 'Un-ignoring files that already exist on disk: land the PR on main before switching back, or git deletes the local copies'
track: knowledge
category: best-practices
module: shared
tags: [git, gitignore, tooling, worktree, harness]
applies_to: [.gitignore]
created: '2026-10-13'
---

# Un-ignoring files that already exist on disk: land the PR on main before switching back, or git deletes the local copies

## When this applies

A PR removes a `.gitignore` entry and commits files that were already sitting in the checkout (gitignored, local-only), for example `CLAUDE.md` and `docs/superpowers/specs/` in #1427. Git treats ignored and tracked files differently when you switch branches:

- **Ignored or untracked** files are left alone on a switch.
- **Tracked** files that the target commit does *not* contain are **removed** from the working tree.

So once the branch commits those files, `git switch main` (while `main` still ignores them) deletes them from disk. That includes any uncommitted edits another session made to them in the shared checkout.

## Smell patterns

- `git switch main` right after opening an "un-ignore" PR fails with `Your local changes to the following files would be overwritten by checkout`. That refusal is the safe outcome: it only fires because someone had edited a tracked file. With no edits, the same switch succeeds silently and deletes the files.
- The PR's diff is mostly additions of files that already exist locally.

## Why

Switching branches is a two-tree diff. A path present in HEAD's tree but absent from the target's tree is removed, whatever `.gitignore` says. The ignore rule only protects files git has never tracked.

## Examples

Safe order, as used for #1427:

```bash
# 1. Stay on the un-ignore branch until the PR has merged.
# 2. Fast-forward the main ref WITHOUT checking it out (allowed while main isn't checked out):
git fetch origin main:main
# 3. Prove the files are identical on both sides, then switch. Local edits are carried over.
git diff --quiet <branch> main -- CLAUDE.md docs/superpowers/specs && git switch main
```

Do this from a dedicated worktree (`git worktree add`) when you can, so the shared checkout never sits on the un-ignore branch.

## Exceptions

- Never resolve the overwrite refusal with `git stash`, `git checkout -f` or `git switch --discard-changes` in a checkout shared with another session. Those edits belong to someone else.
- If the PR is abandoned, the files are safe only while you stay on the branch. Copy them out before switching, or re-add the ignore entry on the branch first.

## Related Files

- `.gitignore`

## See Also

- [git diff is invisible to untracked files](../logic-errors/git-diff-invisible-to-untracked-files-2026-07-15.md) — the inverse trap: untracked files hidden from diff-based checks
