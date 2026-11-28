---
title: "The meal plan day screen shows no allergen line for a recipe with no ingredients, as if it were checked"
status: done
priority: medium
created: 2026-11-27
updated: 2026-11-27
assignee:
labels: [deferred, client, meal-plan, family, allergens]
github_issue:
---

# The day screen passes a no-ingredient recipe as allergen-safe

## Summary

A recipe saved with no ingredients is stored with `allergens: []`
(`server/storage/meal-plan-recipes-crud.ts`, the no-ingredients insert). That
reads as "no allergens found". `getMealClashes` in
`client/components/meal-plan/family-utils.ts` then returns no clash, so the
day screen row (`getItemFamilyInfo`) shows nothing for an eater with an allergy
instead of "Allergens not checked". Simple Entry saves exactly such recipes
(a dish name and totals only), and so do imports without an ingredient list.

## Background

Found while building the pick-time allergen check (todo
`P2-2026-11-20-allergen-warning-when-a-meal-is-picked`). That check treats a
no-ingredient recipe as not checked (`pickedFromRecipe` in
`client/components/meal-plan/pick-allergen-utils.ts`), but the day screen and
its family info are outside that todo's scope. Recipe search already guards
the same case (`server/services/recipe-search.ts`, "safe for me").

## Acceptance Criteria

- [x] A planned recipe with no ingredients shows "Allergens not checked" on the day screen for an eater with an allergy.
- [x] A recipe with ingredients and no allergens found still shows no line (control).
- [x] A test fails without the fix. The fix is on the server, so the failing test is in `server/storage/__tests__/meal-plan-items.test.ts`; the client half (null allergens show "Allergens not checked") was already covered in `family-utils.test.ts` ("says allergens are not checked when they are unknown").

## Implementation Notes

- The day screen's items come from `MealPlanItemWithRelations`; check whether
  the recipe relation carries ingredients or an ingredient count. If not, the
  fix may need the server to return one, or to store `allergens: null` for a
  recipe saved without ingredients (and the backfill to match). A null fits
  the column's own comment: null means not derived.
- Files: `client/components/meal-plan/family-utils.ts`, possibly
  `server/storage/meal-plan-recipes-crud.ts` and
  `server/services/meal-plan/*` for the relation.

## Updates

### 2026-11-27

- Fixed on read, in `getMealPlanItems` (`server/storage/meal-plan-items.ts`):
  a recipe with no ingredient rows goes out with `allergens: null`, so the
  client's existing "unknown" path shows "Allergens not checked". Chosen over
  storing null at write time because it also covers existing rows with no
  migration, and leaves recipe search and the write-card safety checks (which
  already guard on ingredient count) unchanged.
