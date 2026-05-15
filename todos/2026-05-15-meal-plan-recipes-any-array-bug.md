---
title: "Fix = ANY(array) SQL interpolation bug in getRecipesWithEmptyMealTypes"
status: backlog
priority: medium
created: 2026-05-15
updated: 2026-05-15
assignee:
labels: [bug, database, deferred]
github_issue:
---

# Fix = ANY(array) SQL interpolation bug in getRecipesWithEmptyMealTypes

## Summary

`getRecipesWithEmptyMealTypes` in `server/storage/meal-plan-recipes.ts` builds an
ingredient query with `sql`${recipeIngredients.recipeId} = ANY(${recipeIds})``,
which interpolates a JS `number[]`that PostgreSQL cannot coerce. The query
throws`op ANY/ALL (array) requires array on right side`/`malformed array literal: "1"` at runtime.

## Background

Surfaced while adding unit tests for the module
(`todos/archive/2026-05-15-meal-plan-recipes-tests.md`). The bug fires any time
the meal-type inference backfill job runs against recipes that have empty
`mealTypes` AND at least one ingredient row — i.e. the normal case. The two
`getRecipesWithEmptyMealTypes` tests are currently marked `it.skip` in
`server/storage/__tests__/meal-plan-recipes.test.ts` with a reference to this
todo.

## Acceptance Criteria

- [ ] `getRecipesWithEmptyMealTypes` no longer throws when `recipeIds` is a
      non-empty `number[]` — the ingredient lookup returns the expected rows.
- [ ] The two skipped tests in
      `server/storage/__tests__/meal-plan-recipes.test.ts` (`getRecipesWithEmptyMealTypes`
      describe block) are un-skipped (`it.skip` → `it`) and pass.
- [ ] No regression in the meal-type inference backfill path that calls this
      function.

## Implementation Notes

- Bug location: `server/storage/meal-plan-recipes.ts:501-507` — the
  `allIngredients` query inside `getRecipesWithEmptyMealTypes`.
- Fix: replace the raw `sql`... = ANY(${recipeIds})`` with Drizzle's
  `inArray(recipeIngredients.recipeId, recipeIds)` (`inArray` is already a valid
  import from `drizzle-orm`). `inArray` emits a parameterized `IN (...)` list
  PG accepts. If an array-typed bind is preferred, cast explicitly:
  `sql`${recipeIngredients.recipeId} = ANY(${recipeIds}::int[])``.
- `recipeIds` is guaranteed non-empty at the call site (there is an early
  `recipes.length === 0` return above), so no empty-array guard is needed.

## Dependencies

- None.

## Risks

- Low — single-line query change in a backfill-only code path.

## Updates

### 2026-05-15

- Created from a latent bug surfaced by the meal-plan-recipes storage test todo.
