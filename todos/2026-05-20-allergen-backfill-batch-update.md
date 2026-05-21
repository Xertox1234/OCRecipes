---
title: "Batch the allergen backfill UPDATEs + re-derive stale allergen caches"
status: backlog
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

- [ ] Both backfill loops use a single batched `UPDATE … FROM (VALUES …)`
- [ ] Script run re-derives existing allergen caches with the M1-corrected logic
- [ ] Spot-check: a recipe with "almond milk" no longer lists `milk` in its cache

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
