---
title: "P0: Change CASCADE to SET NULL on mealPlanItems foreign keys"
status: backlog
priority: critical
created: 2026-02-06
updated: 2026-02-06
assignee:
labels: [data-integrity, p0, meal-plan, schema]
---

# P0: Change CASCADE to SET NULL on mealPlanItems foreign keys

## Summary

Deleting a recipe or scanned item silently destroys all meal plan items referencing it via CASCADE delete. Users lose meal plan entries with no warning.

## Background

`shared/schema.ts:483-489` — both `recipeId` and `scannedItemId` on `mealPlanItems` use `onDelete: "cascade"`. When a user deletes a recipe, every meal plan item referencing it vanishes instantly. The API returns 204 with no indication that plan items were also removed.

Compare with `savedItems.sourceItemId` which uses `onDelete: "set null"` — a more appropriate pattern for this relationship.

## Acceptance Criteria

- [ ] Change `mealPlanItems.recipeId` from `onDelete: "cascade"` to `onDelete: "set null"`
- [ ] Change `mealPlanItems.scannedItemId` from `onDelete: "cascade"` to `onDelete: "set null"`
- [ ] Update client UI to handle items where `recipe` and `scannedItem` are both null (display "Recipe removed" or similar)
- [ ] Run `npm run db:push` to verify migration applies cleanly
- [ ] No regressions on tests

## Implementation Notes

```typescript
recipeId: integer("recipe_id").references(() => mealPlanRecipes.id, {
  onDelete: "set null",
}),
scannedItemId: integer("scanned_item_id").references(() => scannedItems.id, {
  onDelete: "set null",
}),
```

Consider also adding a database-level CHECK constraint: `CHECK (recipe_id IS NOT NULL OR scanned_item_id IS NOT NULL)` for new inserts, while allowing both to become null via SET NULL cascades on existing rows.

## Dependencies

- None

## Risks

- Items with both FKs set to null after deletion need graceful UI handling
- Need to decide: keep orphaned plan items visible or auto-clean them?

## Updates

### 2026-02-06

- Created from multi-agent code review of `feat/meal-planning-phase-1`
