---
title: "Data integrity: soft-delete orphans + schema gaps (2026-04-28 audit)"
status: in-progress
priority: medium
created: 2026-04-28
updated: 2026-04-28
assignee:
labels: [data-integrity, database]
---

# Data Integrity: Soft-Delete Orphans + Schema Gaps

## Summary

`softDeleteScannedItem` leaves orphaned `mealPlanItems` rows. `batchUpdateMealTypes` omits `updated_at`. Several minor schema issues remain from audit.

## Background

From the 2026-04-28 audit (M2, M3, L5, L6, L7, L8, L9).

## Acceptance Criteria

- [ ] **M2** `softDeleteScannedItem` (`nutrition.ts:135`) — delete or null-out `mealPlanItems` rows referencing the soft-deleted `scannedItemId` within the same transaction (consider cascading to avoid orphan meal plan entries with missing nutrition)
- [ ] **M3** `dailyLogs.recipeId` (`schema.ts:156`) — evaluate adding `recipeType` discriminator to support community recipes; or document as intentional design choice in `docs/patterns/database.md`
- [ ] **L5** `batchUpdateMealTypes` (`meal-plans.ts:930`) — add `updated_at = NOW()` to the raw SQL UPDATE (matching `batchUpdateCommunityMealTypes`)
- [ ] **L7** `coachResponseCache` unique index — evaluate changing from `(questionHash)` to `(userId, questionHash)` to make DB constraint match semantic intent
- [ ] **L9** `receipt-ocr-parser.ts:92` — add upper-bound cap on `parseInt` quantity (e.g. max 99) before surfacing to `ReceiptReviewScreen`

## Implementation Notes

For M2: the `mealPlanItems` table has a CHECK constraint `hasNutritionSource` requiring either `recipeId IS NOT NULL OR scannedItemId IS NOT NULL`. Nulling `scannedItemId` would violate this unless `recipeId` is also set. Deleting the `mealPlanItems` row is safer.

For L5: the raw SQL already sets `meal_types`, just needs `, updated_at = NOW()` added.

## Updates

### 2026-04-28

- Created from audit findings M2, M3, L5, L7, L9
