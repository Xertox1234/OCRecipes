---
title: Landing a stacked PR chain — GitHub may auto-close a child PR when its base branch is deleted; re-file, the verdict carries over on a byte-identical tree
track: knowledge
category: best-practices
tags: [git, github, stacked-prs, merge-workflow, land]
module: shared
created: 2026-07-12
---

# Landing a stacked PR chain — GitHub may auto-close a child PR when its base branch is deleted; re-file, the verdict carries over on a byte-identical tree

## When this applies

Squash-merging a chain of stacked PRs (child PRs based on sibling feature branches) with `--delete-branch`, on this repo's protected `main`.

## Examples

Checklist, learned landing the 2026-07 Coach chain (#579 → #581/#583 → #582):

1. **Expect the auto-close.** GitHub does not reliably retarget a child PR to `main` when its base branch is deleted on merge — the child can flip to CLOSED with a merge-conflict hint that references the now-deleted base. This CLOSED is a mechanical artifact, not a rejection; do not treat it under the "closed-without-merge = rejection signal" sweep rule.
2. **Closed PRs are unrecoverable in place.** `gh pr edit --base` and `gh pr reopen` both fail on a closed PR whose base is gone. Recovery is a **new PR** from the same head branch to `main`, linking the closed one.
3. **Review verdicts transfer only on identical trees.** Before claiming the old verdict, prove `git diff <reviewed-sha> <new-head>` is empty (rebasing onto the parent's squash normally replays to a byte-identical tree, since the squash content equals the branch content). Any non-empty diff means a fresh verdict on the delta.
4. **Rebase children past each squash with `--onto`.** `git rebase --onto origin/main <old-parent-tip> <child>` replays only the child's own commits; a plain `rebase origin/main` tries to replay the parent's already-squashed commits and manufactures conflicts.
5. **Prefer `gh pr merge --auto` over racing checks.** Branch protection counts required checks that register late (test shards, coverage); an immediate merge attempt fails with "add the --auto flag" even when the visible checks are green.
6. **Squash-merge `git cherry` shows `+` for landed commits** — patch-ids don't match the squash. Climb the ladder: named `(#N)` squash commit on main, then a content check (`git diff main <branch>` empty for the last-merged branch, `git grep` a distinctive symbol for earlier ones) before `branch -D`.

## Exceptions

Chains merged with merge-commits (not squash) keep SHA ancestry — retargeting and `git cherry` behave normally, and most of this checklist is unnecessary.

## Related Files

- `.claude/skills/land/SKILL.md` — the base landing ritual this extends for stacked chains

## See Also

- (none yet)
