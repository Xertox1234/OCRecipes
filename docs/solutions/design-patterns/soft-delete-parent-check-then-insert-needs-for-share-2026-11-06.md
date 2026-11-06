---
title: "Once a parent is soft-deleted, the FK no longer refuses a child — a check-then-insert must lock the parent row FOR SHARE, and readers must skip deleted parents"
track: knowledge
category: design-patterns
tags: [database, soft-delete, for-share, race, postgres, junction, orphan, read-committed]
module: server
created: 2026-11-06
---

# A check-then-insert against a soft-deletable parent needs FOR SHARE

## When this applies

Any write that checks a parent exists, then inserts a child or junction row pointing at it: plan items, favourites, cookbook entries. It applies especially when the parent became soft-deletable (personal recipes since #1631) or the link is polymorphic with no FK.

## Rule

- Check the parent inside the insert's transaction with `SELECT … FOR SHARE` (or `FOR SHARE` inside the `EXISTS` guard of an `INSERT … SELECT`), filtering ownership and `deleted_at IS NULL` in the same statement.
- The delete path must touch the parent row **before** its junction cleanup (soft-delete `UPDATE`, or `DELETE` of the row, then the cleanup). Both recipe delete paths do.
- Readers that aggregate children (planned totals, grocery ingredients, counts) skip soft-deleted parents too, which covers legacy rows.

## Why

Under READ COMMITTED a plain existence `SELECT` sees the parent alive; the delete then commits and runs its junction cleanup; our insert commits after the cleanup — an orphan (a hard FK would refuse it, a soft delete doesn't). With `FOR SHARE`:

- our lock first → the delete's row write waits for our commit, then its cleanup (a later statement) sees and removes our row;
- the delete first → our locked select waits, re-checks the row after it commits, and finds nothing.

A multi-connection race test reproduced the favourite orphan on unfixed code (20 iterations), green after.

## Examples

- `server/storage/meal-plan-items.ts` `addMealPlanItem` (returns `undefined` → route 404)
- `server/storage/favourite-recipes.ts` `toggleFavouriteRecipe` (`.for("share")` on both branches)
- `server/storage/cookbooks.ts` `addRecipeToCookbook` (`FOR SHARE` inside the `EXISTS` guards)
- `server/storage/__tests__/favourite-recipes.concurrent.test.ts`

## Related Files

- `server/storage/meal-plan-recipes-crud.ts` (`deleteMealPlanRecipe`), `server/storage/community-recipes.ts` (`deleteCommunityRecipe`)
- `server/storage/meal-plan-analytics.ts` (readers skip deleted recipes)

## See Also

- `docs/solutions/design-patterns/recompute-aggregate-under-lock-2026-05-17.md`
- `docs/rules/database.md` (check-then-act re-checks inside the write)
