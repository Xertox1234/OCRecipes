---
title: Polymorphic-FK junction insert verifies the parent but not the target (IDOR)
track: bug
category: logic-errors
tags: [idor, security, polymorphic-fk, junction-table, drizzle, storage-layer]
module: server
applies_to: ["server/storage/**/*.ts"]
symptoms:
  - An authenticated user adds a recipe/item to their own collection and the resolved collection returns another user's private resource
  - A junction `(parent_id, target_id, target_type)` insert succeeds for a `target_id` the caller never had access to
  - A previously-public resource that was made private still appears in collections that referenced it
created: 2026-05-16
severity: high
---

# Polymorphic-FK junction insert verifies the parent but not the target (IDOR)

## Problem

`cookbookRecipes` is a polymorphic-FK junction: `(cookbook_id, recipe_id, recipe_type)` where `recipe_type` discriminates `mealPlan` vs `community` (no DB-level FK on `recipe_id`). `addRecipeToCookbook` guarded its `INSERT…SELECT` with a `WHERE EXISTS` on `cookbooks.user_id` — proving the caller owns the **cookbook**. It never checked the **target recipe**. `getResolvedCookbookRecipes` then batch-fetched `mealPlanRecipes`/`communityRecipes` by id with no `userId`/`isPublic` filter.

Net effect: an authenticated user could `POST {recipeId: <enumerated int>, recipeType: "mealPlan"}` to their _own_ cookbook and then `GET` it to read another user's private meal-plan recipe metadata (title, description, imageUrl, servings, difficulty). `mealPlanRecipes.id` is a sequential integer, so the whole table was enumerable.

The trap: the write path _had_ a guard (added by an earlier hardening pass), so a reviewer scanning for "is the write path filtered?" sees a `WHERE EXISTS` and moves on — but the guard scoped the wrong row.

## Symptoms

- A junction insert guarded only by parent ownership accepts any `target_id`
- The collection's resolve query fetches target rows by id with no visibility predicate
- Cross-user private metadata surfaces in a collection the attacker fully controls

## Root Cause

For a polymorphic junction, "the caller owns the parent" and "the caller may reference the target" are **two independent authorization facts**. Verifying only the parent leaves the target unauthenticated. The resolve path compounded it by trusting every junction row's `target_id` unconditionally.

## Solution

**Add path** — extend the `INSERT…SELECT` with a second `EXISTS` scoping the target, branched on the discriminator:

```ts
const recipeAccessGuard =
  recipeType === "mealPlan"
    ? sql`AND EXISTS (
        SELECT 1 FROM ${mealPlanRecipes}
        WHERE ${mealPlanRecipes.id} = ${recipeId}
          AND ${mealPlanRecipes.userId} = ${userId}
      )`
    : sql`AND EXISTS (
        SELECT 1 FROM ${communityRecipes}
        WHERE ${communityRecipes.id} = ${recipeId}
          AND (${communityRecipes.isPublic} = true
               OR ${communityRecipes.authorId} = ${userId})
      )`;
// …appended after the existing cookbook-ownership EXISTS, before ON CONFLICT.
```

The community guard is `isPublic = true OR authorId = userId` — a user must still be able to cookbook their own unpublished community recipe (matches the project IDOR rule's two-clause visibility: `eq(isPublic, true)` OR `eq(authorId, userId)`).

**Resolve path** — apply the visibility check in the JS resolution loop, **not** the SQL `WHERE`, so orphan detection still works:

```ts
if (!recipe) {
  orphanIds.push(row.id);            // target row genuinely gone → clean up
} else if (recipe.userId === userId) // mealPlan: owner
  /* or */ else if (recipe.isPublic || recipe.authorId === userId) {
  resolved.push({ … });              // visible → return
}
// recipe exists but not visible → hidden, junction row KEPT
```

The critical distinction: **hidden ≠ orphan**. A target that no longer exists is an orphan (delete the junction row). A target that exists but is not currently visible (e.g. a community recipe that was made private) must be _hidden from the response but its junction row preserved_ — otherwise re-publishing the recipe silently loses the user's collection entry.

## Prevention

- Treat every polymorphic-FK junction insert as needing two ownership facts: parent **and** target.
- Filter the batch-fetch's _exposure_ in JS when the same query also drives orphan cleanup — an SQL `WHERE` filter conflates "gone" with "not visible" and causes data loss.
- A `WHERE EXISTS` already present on a write path is not evidence the write is safe — confirm _which row_ it scopes.

## Related Files

- `server/storage/cookbooks.ts` — `addRecipeToCookbook`, `getResolvedCookbookRecipes`
- `server/storage/__tests__/cookbooks.test.ts` — 5 IDOR regression tests (add-path + resolve-path)
- `docs/rules/security.md` — IDOR / polymorphic-junction rules
- `docs/audits/2026-05-16-full.md` — audit manifest (finding H1)

## See Also

- `docs/solutions/logic-errors/premium-gate-parity-missed-read-endpoints-2026-05-13.md` — sibling class: a guard applied to one path but not its counterpart
