---
title: "Batch the allergen backfill UPDATEs + re-derive stale allergen caches"
status: done
priority: low
created: 2026-05-20
updated: 2026-05-20
assignee:
labels: [deferred, database]
github_issue:
---

# Batch the allergen backfill UPDATEs + re-derive stale allergen caches

## Summary

`server/scripts/backfill-recipe-allergens.ts` issues one `db.update()` per row
(rule #19 anti-pattern). Convert to a single-round-trip `UPDATE … FROM (VALUES …)`.
While doing so, run it once to refresh the now-stale `allergens` caches produced
before the 2026-05-20 allergen-matcher fix (M1).

## Background

Found in the 2026-05-20 full audit (L4) and connected to M1. The script loops
rows and runs a per-row UPDATE for both community (`:48-52`) and meal-plan
(`:76-80`). Low severity — one-shot script, not a hot path — but the same module's
`batchUpdateMealTypes` already demonstrates the correct single-round-trip form.

**M1 connection:** the 2026-05-20 audit fixed `deriveRecipeAllergens` so plant
substitutes ("almond milk", "oat flour") no longer carry the substituted
allergen. Any `mealPlanRecipes`/`communityRecipes.allergens` rows derived before
that fix are stale (carry the old false positives). Re-running this backfill
re-derives them. No prod data exists yet, so this is a dev/test refresh.

## Acceptance Criteria

- [x] Both backfill loops use a single batched `UPDATE … FROM (VALUES …)`
- [ ] Script run re-derives existing allergen caches with the M1-corrected logic
      (deferred — requires a live DATABASE_URL; run in main checkout)
- [ ] Spot-check: a recipe with "almond milk" no longer lists `milk` in its cache
      (deferred — requires a live DATABASE_URL; run in main checkout)

## Implementation Notes

Pattern reference: `batchUpdateMealTypes` in the same storage area. Keep the
script idempotent.

## Risks

- The batched UPDATE must preserve null-vs-empty-array semantics on the
  `allergens` column (null = not derived, `[]` = analyzed/no allergens).

## Updates

### 2026-05-20

- Initial creation (deferred from 2026-05-20 full audit, finding L4; tied to M1
  cache staleness).

### 2026-05-21

- Code change complete (criterion 1): both `backfillCommunityRecipes` and
  `backfillMealPlanRecipes` now issue a single batched `UPDATE … FROM (VALUES …)`
  mirroring `batchUpdateMealTypes`. `eq` import dropped, `sql` added. Per-arm
  `if (updates.length === 0) return 0;` guards prevent invalid empty-VALUES SQL.
  `::jsonb` cast preserves `[]`-as-empty-array; rows absent from VALUES keep
  their existing value, so null-vs-empty semantics are intact. Original behavior
  preserved — `updated_at` is intentionally NOT bumped (the prior per-row loop
  did not bump it either). Verified: `check:types`, `lint`, full Vitest suite
  (5339 tests) all green; kimi-review (database,security,architecture) found
  nothing.
- **DEFERRED to user (criteria 2 + 3):** the actual script run that re-derives
  existing allergen caches and the "almond milk no longer lists milk" spot-check
  REQUIRE a live `DATABASE_URL`, which is unset in the executor worktree. Run
  `npx tsx server/scripts/backfill-recipe-allergens.ts` (optionally `DRY_RUN=1`
  first) in the main checkout against a real DB to complete these.
