---
title: "Make getMealPlanRecipe / getMealPlanRecipeWithIngredients require userId"
status: backlog
priority: low
created: 2026-05-25
updated: 2026-05-25
assignee:
labels: [deferred, security, database]
github_issue:
---

# Make getMealPlanRecipe / getMealPlanRecipeWithIngredients require userId

## Summary

Harden the meal-plan recipe single-fetch reads so `userId` is a required (non-optional) parameter, mirroring the `getCommunityRecipe(id, userId)` IDOR hardening. Closes a signature footgun where a future caller could omit the scope and leak another user's meal-plan recipe.

## Background

Deferred from the 2026-05-25 full audit (finding L3). `getMealPlanRecipe(id, userId?)` and `getMealPlanRecipeWithIngredients(id, userId?)` in `server/storage/meal-plan-recipes-crud.ts` keep `userId` optional and fall back to an `id`-only `WHERE` when it is omitted. The sibling `getCommunityRecipe` was made required for exactly this reason.

**Not exploitable today:** both production callers already pass `req.userId` — `server/routes/meal-plan.ts:120` and `:425` (the latter has an explicit "IDOR: verify recipe belongs to user" comment).

**Why deferred:** making `userId` required forces it on both paired functions and breaks ~22 integration-test call sites in `server/storage/__tests__/meal-plans.test.ts` and `meal-plan-recipes.test.ts` that legitimately call these unscoped — mostly files outside the audit's changed-file scope. The churn/benefit ratio was poor for a non-exploitable Low, so it was deferred for a focused pass.

## Acceptance Criteria

- [ ] `getMealPlanRecipe(id, userId)` — `userId` is required; `WHERE` always scopes by `id AND userId`
- [ ] `getMealPlanRecipeWithIngredients(id, userId)` — `userId` is required; passes it through
- [ ] All call sites updated (production already pass userId; update the ~22 test call sites to pass a userId — for "nonexistent id" / "fetch what I created" tests, pass the seeding user's id)
- [ ] `npm run check:types` clean; both storage test files pass

## Implementation Notes

- Files: `server/storage/meal-plan-recipes-crud.ts` (both functions), `server/storage/__tests__/meal-plans.test.ts`, `server/storage/__tests__/meal-plan-recipes.test.ts`.
- Use the LSP tool (`findReferences`) on both symbols before editing to confirm the full call-site list — the facade (`server/storage/index.ts`) re-exports them, so `storage.getMealPlanRecipe*` route callers won't surface via source-symbol find-references alone.
- Mirror the `getCommunityRecipe` pattern: `where(and(eq(mealPlanRecipes.id, id), eq(mealPlanRecipes.userId, userId)))`.

## Dependencies

- None.

## Risks

- Test churn (~22 sites). Mechanical, but verify the "returns undefined for nonexistent id" tests still pass with a userId arg.

## Updates

### 2026-05-25

- Initial creation (deferred from 2026-05-25 full audit, finding L3).
