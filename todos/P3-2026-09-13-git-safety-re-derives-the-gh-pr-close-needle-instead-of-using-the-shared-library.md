---
title: "git-safety.sh re-derives the `gh pr close` needle on raw $CMD instead of using the shared extractor, so a root-position repo flag skips its advisory"
status: backlog
priority: low
created: 2026-09-13
updated: 2026-09-13
assignee:
labels: [deferred, harness]
github_issue:
---

# `git-safety.sh` re-derives a needle the shared library already owns

## Summary

`git-safety.sh:559,561` carries its own hand-written copy of the `gh pr close` needle,
matched against **raw `$CMD`** with no quote-aware rendering and no globals slot. A
root-position repo flag (`gh -R owner/repo pr close 42`) therefore skips its
unmerged-branch advisory. The destructive action itself is **denied** by
`guard-outward-cli.sh`, so this is a missing warning, not an open bypass.

## Background

Found while closing
`todos/P0-2026-09-13-repo-retarget-flag-in-root-position-defeats-both-merge-guards.md`.
That P0 widened `lib/cmd-detect.sh` and `guard-outward-cli.sh` so a flag sitting between
the binary and its namespace no longer hides the invocation. `git-safety.sh` inherited
nothing, because it never sourced the library:

```
559: elif printf '%s' "$CMD" | grep -qE '(^|[;&|[:space:]])gh[[:space:]]+pr[[:space:]]+close[[:space:]]+'; then
560:   KIND="delete"
561:   REF=$(printf '%s' "$CMD" | sed -nE 's/.*gh[[:space:]]+pr[[:space:]]+close[[:space:]]+([^[:space:];&|]+).*/\1/p')
```

Verified 2026-09-13 that the file contains no `. …/lib/cmd-detect.sh` line, so this is a
re-derivation rather than a consumer that needs re-widening.

`.claude/agents/code-reviewer.md:187` names this exact shape — a hand-rolled command needle
alongside a shared quote-aware scanner — as the smell the library exists to eliminate.

## Why this is LOW, not a security finding

Measured 2026-09-13 by running the merge-base guard and the fixed guard against the same
envelope, no outward CLI executed:

| command                       | `guard-outward-cli` @ `e50a5d08` (pre-fix) | `guard-outward-cli` @ this branch |
| ----------------------------- | ------------------------------------------ | --------------------------------- |
| `gh -R other/org pr close 42` | ALLOW                                      | **DENY**                          |
| `gh -R other/org pr merge 42` | ALLOW                                      | **DENY**                          |

So the P0 fix already closed the reachable half. What remains is that `git-safety.sh`'s
advisory — the "this closes a PR whose branch may be unmerged" warning, which calls
`warn()` and never blocks — does not fire on that spelling. A missing warning behind a
hard deny.

The second, larger half is that the same file also models **no quote-aware rendering at
all**, so `g"h" pr close 42` and friends miss too. That is pre-existing and unrelated to
root position; it is the reason to port rather than patch.

## Acceptance Criteria

- [ ] `git-safety.sh` detects `gh pr close` through `lib/cmd-detect.sh` rather than its own
      raw-`$CMD` needle, so it inherits the quote-aware rendering and the globals slot.
- [ ] The advisory fires for all four root-position spellings (`-R v`, `--repo v`,
      `--repo=v`, `-Rv`) and for a quoted binary rendering.
- [ ] Two-sided in the same run: ordinary prose naming the verb, and a read-only
      `gh -R owner/repo pr view 42`, do NOT trigger the advisory.
- [ ] `test-git-safety.sh` covers both directions; its assertion-total pin is updated
      deliberately.
- [ ] Mutation-verified: reverting the new detection leaves only its own rows red.

## Implementation Notes

- `cmd_gh_pr_write_subcommand` already returns `close`, and `cmd_gh_pr_ref` already returns
  the ref with the retarget refusal applied — so the port is mostly deleting the two
  hand-written lines and reading the library's answer instead. Note `cmd_gh_pr_ref` REFUSES
  (rc 1) on a retarget, which for this advisory means "cannot name the branch" — route that
  to the existing `SKIP_REASON` path rather than to a wrong branch name.
- `git-safety.sh` must keep working when the lib is unsourceable. It is an advisory hook,
  so the safe direction there is silence, matching `pr-verify.sh`'s `|| exit 0`.
- `.claude/hooks/**` feeds the **required** `Outward-CLI guard corpus` check. Run it against
  **branch ⊕ main**, not the bare tip.

## Scope Contract

- **Mechanisms to use:** the existing `lib/cmd-detect.sh` functions. No new detector, no new
  constant.
- **Files in scope:** `.claude/hooks/git-safety.sh`, `.claude/hooks/test-git-safety.sh`.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None. The P0 it was found under is already fixed; this is the un-ported sibling.

## Risks

- `git-safety.sh` has 126 pinned assertions; sourcing the lib changes what the detector sees
  for every existing row, not just the new ones. Re-run the whole file, not the new section.
- Over-firing an advisory is cheap (a warning), but this hook shares `KIND="delete"` with
  the `git branch -D` / `git push --delete` paths — do not widen those by accident.

## Updates

### 2026-09-13

- Filed while closing the root-position P0, at the user's direction to surface rather than
  fold in: different verb, different file, and it needs porting onto the shared library,
  which is its own change.
