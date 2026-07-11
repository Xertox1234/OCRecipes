---
title: "Restore and merge a closed PR after its head branch was deleted"
track: knowledge
category: best-practices
tags: [github, pull-request, git, branch-restore, reopen, checks]
module: shared
created: 2026-07-11
---

# Restore and merge a closed PR after its head branch was deleted

## When this applies

A PR was closed unmerged and its head branch deleted (via
`gh pr close --delete-branch`, GitHub's auto-delete-on-close, or a manual
sweep) — and the decision is later reversed: the change should merge after
all. Recreating a fresh PR loses the number, review history, and any
completed check runs; this checklist restores the original instead.

## Why

Three platform facts make restoration cheap:

1. **Deleting a branch does not delete its commits.** After `git branch -D`
   locally and a remote-branch delete, the commit objects survive in the
   local object store (reachable via reflog and by SHA) until garbage
   collection — typically weeks.
2. **GitHub can only reopen a PR whose head ref exists.** Re-pushing the
   preserved commit to the *exact original ref name* satisfies this; the
   reopened PR is the same PR (same number, same reviews, same diff).
3. **Check runs attach to the head SHA, not the branch.** Runs that already
   completed against that SHA still count toward required checks after
   reopening; only workflows triggered by the fresh branch-create/push event
   run again. A docs-only PR that was green stays mostly green.

## Examples

The sequence (brace the SHA — see the zsh gotcha in See Also):

```bash
# 1. Recover the head commit SHA (reflog if you no longer know it)
FULL_SHA=$(git rev-parse <short-sha>)        # or: git reflog | grep <branch>

# 2. Re-push it to the original ref name — this "restores" the branch
git push origin "${FULL_SHA}:refs/heads/<original-branch-name>"

# 3. Reopen — same PR number, reviews and green SHA-keyed checks intact
gh pr reopen <N>

# 4. Wait for the re-triggered subset, then merge as normal
gh pr checks <N> --watch
gh pr merge <N> --squash    # or mcp__github__merge_pull_request
```

Post-merge: if the repo auto-deletes head branches on merge, a follow-up
`git push origin --delete <branch>` fails with `remote ref does not exist` —
benign, but it aborts a `&&`-chained cleanup command; check before chaining.

## Exceptions

- **Commit no longer local anywhere** (gc'd, or created on a machine you lost):
  restore via GitHub's "Restore branch" button on the closed PR page instead —
  GitHub retains the ref's objects server-side.
- **Base moved meaningfully since closing:** reopening is still fine, but
  re-verify CI freshness against the new base before merging rather than
  trusting the old green runs.
- **Different ref name won't work:** pushing the commit under a new branch
  name creates a *new* PR head — the closed PR can only reopen on its
  original ref.

## Related Files

- `.claude/hooks/pr-preflight-guard.sh` — the restore push is a normal push;
  it runs the pre-push fast gate and needs a HEAD-matching stamp like any other.

## See Also

- [../logic-errors/zsh-unbraced-var-colon-applies-csh-modifier-2026-07-11.md](../logic-errors/zsh-unbraced-var-colon-applies-csh-modifier-2026-07-11.md) — why step 2 must brace `${FULL_SHA}`: unbraced, zsh eats the `:r` of `:refs/…`.
