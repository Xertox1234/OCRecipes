---
title: "Rebase and merge 6 remaining PRs from 2026-05-10 /todo session"
status: backlog
priority: high
created: 2026-05-11
updated: 2026-05-11
assignee:
labels: [merge-cleanup, deferred]
github_issue:
---

# Rebase and merge 6 remaining PRs from 2026-05-10 /todo session

## Summary

The 2026-05-10 `/todo` session shipped 18 PRs; 12 merged cleanly during the follow-up merge round. The remaining 6 PRs are in CONFLICTING state and need rebase + conflict resolution before merge.

## Background

During the merge round, each successful merge advanced `main`, and a few PRs that were initially MERGEABLE flipped to CONFLICTING as the files they touched moved underneath them. Four PRs were already CONFLICTING at the start of the merge round because `main` had picked up two audit-resolution commits (`5b78732a fix: resolve full audit findings`, `c293aa2b docs: codify patterns and learnings from full audit 2026-05-10`) during the original `/todo` execution. All 6 PRs have green CI on their head commit; the only blocker is the rebase.

## Acceptance Criteria

- [ ] PR #113 (Data export endpoint) rebased onto current main and merged
- [ ] PR #117 (Coach blocks accessibility M8–M13) rebased and merged
- [ ] PR #118 (Fix carousel cuisine labels) rebased and merged
- [ ] PR #119 (Health data consent screen) rebased and merged
- [ ] PR #125 (TastePicks/onboarding error handling) rebased and merged — see merge note in PR body about resolving against #123's catch-block changes
- [ ] PR #128 (Batch low-severity audit L1–L8) rebased and merged
- [ ] After each merge, the corresponding worktree under `.claude/worktrees/` is removed and the local branch deleted
- [ ] The leftover stash `stash@{0}: leaked-from-agents-batch-2026-05-10` is dropped after PR #127's content is confirmed in main (it already merged, but worth verifying before drop)

## Implementation Notes

### Per-PR rebase recipe

For each PR, in its existing worktree under `.claude/worktrees/agent-*`:

```bash
cd .claude/worktrees/agent-<id>
git fetch origin
git rebase origin/main
# resolve conflicts file-by-file:
#   - docs files (append-only): usually trivial; prefer keeping both additions
#   - source files: read carefully — kimi-review notes in the PR body explain intent
git push --force-with-lease
```

Then re-attempt merge:

```bash
gh pr merge <PR#> --squash --delete-branch
```

### Known conflict shapes per PR

| PR   | Files with expected conflicts                                                                                                                                                                     | Resolution hint                                                                                                                                                                                |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #113 | `client/screens/SettingsScreen.tsx`, possibly `server/routes.ts`                                                                                                                                  | Settings row additions stack with #110/#111/#121 rows — keep all sections                                                                                                                      |
| #117 | `client/components/coach/blocks/*` (7 files), `docs/rules/accessibility.md`, `docs/LEARNINGS.md`                                                                                                  | Combine with #122's React.memo wraps (already in main); the a11y attrs and memo wrappers are orthogonal — apply both                                                                           |
| #118 | `server/storage/taste-picks.ts`, `client/screens/TasteProfileScreen.tsx`, `server/services/carousel-builder.ts`                                                                                   | Main now has audit-resolution changes here from `5b78732a`; the cuisinePreferences fix is the genuine work — preserve it                                                                       |
| #119 | `client/context/OnboardingContext.tsx` (vs #123 memoization), `shared/schema.ts` (vs #120's TastePicks additions), `docs/rules/security.md` (vs #112/#120), `server/routes/_schemas.ts` (vs #112) | Largest rebase. Schema is the trickiest — both PRs added columns; just stack the migrations                                                                                                    |
| #125 | `client/context/OnboardingContext.tsx` (vs #123 memoization + the new partial-failure recovery code)                                                                                              | See PR body's merge note: #125's catch-block behavior (re-throw) wins over #123's catch (swallow); also keep the `profileSaved` phase tracking + `checkAuth()` resync added in the round-2 fix |
| #128 | `server/services/nutrition-coach.ts` (vs #129 Zod safeParse), `server/storage/taste-picks.ts` (vs #118 if merged), several `client/screens/*.tsx` touched by main's audit-resolution              | Many small surgical fixes; reviewer should validate each pre-and-post-rebase against the L-numbered audit findings in the original todo                                                        |

### Cleanup commands after each merge

```bash
# Identify worktree for the merged PR's branch
wt=$(git worktree list | awk -v b="[todo/<slug>]" '$NF==b{print $1}')
[ -n "$wt" ] && git worktree unlock "$wt" 2>/dev/null && git worktree remove --force "$wt"
git branch -D "todo/<slug>"
git fetch origin --quiet && git pull --ff-only origin main
```

### Order recommendation

Merge low-overlap PRs first to reduce re-conflict cascading (same strategy that worked in the original merge round):

1. **#117** — limited overlap (just docs + 7 block files) — clean first
2. **#118** — TastePicks/carousel scope
3. **#125** — OnboardingContext only, single file
4. **#113** — Settings stacking
5. **#128** — many files; do after #118 to avoid double-rebase on taste-picks
6. **#119** — largest rebase, save for last

## Dependencies

- All 6 PRs are open at https://github.com/Xertox1234/OCRecipes/pulls — CI green on each
- Worktrees still exist under `.claude/worktrees/agent-*` (one per PR) with the original commits intact
- Each PR's body contains the kimi-review trail and any merge-resolution notes — read before resolving conflicts

## Risks

- **#119 schema rebase**: `shared/schema.ts` rebases against #120's `cuisineOrigin` taste-picks columns. If column-add order in the actual DB migration is non-trivial, this needs a manual review of `db:push` output before merging.
- **#117 vs #122 already-merged**: #122 wrapped all 7 coach block components in `React.memo`. #117's accessibility attrs need to be applied to the already-memoized files — confirm the memo wrapper is preserved during conflict resolution.
- **#125 catch-block precedence**: #123 (already merged) added try/catch + console.error to skipOnboarding/completeOnboarding _without_ re-throw. #125 needs to overwrite that with the re-throw + profileSaved phase tracking + checkAuth() resync from the kimi-review continuation. Easy to miss during a quick rebase.
- **#128 nutrition-coach overlap**: #129 (already merged) added the three-stage guard for tool-call args. #128 also modified nutrition-coach.ts for L-number fixes. Both changes are valuable — don't drop either.

## Updates

### 2026-05-11

- Created after the 2026-05-10 /todo session's merge round. 12 of 14 clean PRs merged; 6 remain CONFLICTING and need rebase work captured here.
