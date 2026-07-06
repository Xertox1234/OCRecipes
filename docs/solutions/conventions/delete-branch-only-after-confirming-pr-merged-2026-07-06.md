---
title: 'Deleting a branch that is an open PR''s head closes the PR unmerged'
track: knowledge
category: conventions
module: shared
tags: [git, github, pull-request, automation, process]
applies_to: [.claude/skills/todo/SKILL.md]
created: '2026-07-06'
---

# Deleting a branch that is an open PR's head closes the PR unmerged

## Rule

Never delete a remote branch as part of a "these are all merged, clean up now" sweep without confirming, **per branch, immediately beforehand**, that its PR actually reports `merged: true` — from the merge API's own response, or a fresh PR read. `git push origin --delete <branch>` on a branch that is still the HEAD ref of an **open** GitHub PR closes that PR silently, without merging, even if you believe you already merged it moments earlier in the same session.

## Smell patterns

- A branch-deletion loop driven by a list of names planned before the batch ran, rather than by a fresh per-branch state check at deletion time.
- A merge step that had to pause mid-flow (a conflict requiring an out-of-band fix) inside a longer batch of otherwise-uneventful merges — easy to lose track of which ones actually completed.

## Why

GitHub ties a PR's open/closed state to its head branch's existence for as long as the PR hasn't been merged. A batch cleanup step that assumes "I merged N PRs, therefore all N branches are safe to delete" only holds if **every** merge call in the batch was confirmed to actually complete — not just attempted. If one PR's merge is interrupted (e.g. a real merge conflict requires an out-of-band fix-and-repush before the merge call can succeed) and the orchestrator moves on to the next PRs without circling back to reissue the merge call, a later "delete all merged branches" sweep can still include that PR's branch by name — closing it unmerged, with no error and no obvious signal that anything went wrong.

## Examples

Before any branch-deletion loop, verify per-branch instead of trusting a plan drafted before the batch ran:

```bash
gh pr view <num> --json state,merged --jq '"\(.state) merged=\(.merged)"'
```

Only delete if `merged=true`. If a PR is unexpectedly `open`/`merged=false` at cleanup time, stop and re-drive its merge (or investigate) before touching its branch.

If the mistake already happened: the head commit is usually still fetchable by SHA for some time after the branch is deleted (not guaranteed indefinitely — eventual GC) — `git fetch origin <sha>`, then `git push origin <sha>:refs/heads/<branch-name>` recreates the branch and the PR can be reopened (`gh pr reopen` or the equivalent API call) against the current base.

## Exceptions

None — this check is one cheap API call per branch relative to the cost of silently losing a merge.

## Related Files

- `.claude/skills/todo/SKILL.md` — Phase 0's cleanup sweep already gates branch deletion on `state=="MERGED"` from a batch `gh pr list` snapshot; this rule is the same principle applied to an interactive, mid-session batch-merge where the "which PRs actually merged" list must be re-derived fresh, not carried over from an earlier plan.

## See Also

- [Batch-merging independent PRs: re-verify mergeable_state before each merge](../best-practices/batch-merge-can-invalidate-clean-mergeable-state-2026-07-06.md) — same session incident, upstream cause
