---
title: "Move toggleFavouriteRecipe ownership check inside the advisory-locked tx"
status: backlog
priority: low
created: 2026-05-25
updated: 2026-05-25
assignee:
labels: [deferred, database]
github_issue:
---

# Move toggleFavouriteRecipe ownership check inside the advisory-locked tx

## Summary

Fold the recipe-exists/visibility check in `toggleFavouriteRecipe` into the advisory-locked transaction (after the lock, before the insert), per the recompute-aggregate-under-lock pattern. Defense-in-depth only — not a current bug.

## Background

Deferred from the 2026-05-25 full audit (finding L5). `server/storage/favourite-recipes.ts` verifies recipe ownership/access BEFORE opening the limit-check transaction. Database rule #23 prefers the ownership verification INSIDE the advisory-locked tx so the check and the limited insert are atomic.

**Not a bug today:** the post-lock `existing`-row lookup plus the unique-constraint catch already close the limit-bypass and duplicate-insert races; the ownership check also lives in the storage function (not just the route). This is a defense-in-depth alignment with the documented pattern, not a correctness fix.

## Acceptance Criteria

- [ ] Ownership/visibility verification runs inside the advisory-locked transaction (after the lock, before the insert)
- [ ] Existing favourite-recipes tests still pass; add a test only if the move changes an observable contract

## Implementation Notes

- File: `server/storage/favourite-recipes.ts` (`toggleFavouriteRecipe`).
- Reference: `docs/solutions/design-patterns/recompute-aggregate-under-lock-2026-05-17.md` and `docs/rules/database.md` rule #23.
- Keep it minimal — this is a re-ordering within the existing function, not a redesign.

## Dependencies

- None.

## Risks

- Low. Re-ordering reads inside a tx; verify no behavior change for the happy path.

## Updates

### 2026-05-25

- Initial creation (deferred from 2026-05-25 full audit, finding L5).
