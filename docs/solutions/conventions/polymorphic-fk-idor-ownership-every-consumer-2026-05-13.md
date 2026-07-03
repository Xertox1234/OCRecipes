---
title: 'Polymorphic FK IDOR: verify ownership at every consumer'
track: knowledge
category: conventions
module: server
tags: [security, idor, polymorphic-fk, storage, drizzle]
applies_to: [server/storage/**/*.ts]
created: '2026-05-13'
---

# Polymorphic FK IDOR: verify ownership at every consumer

## Rule

When a junction table uses the polymorphic FK pattern (`recipeId` + `recipeType` discriminator, no DB-level FK), **every consumer function** — toggle, resolve, share, count — must independently verify ownership. The lack of a DB-level FK means there is no cascade or referential integrity check; the application code is the only enforcement layer.

This is not the same as the standard "storage mutation includes userId" pattern. In the polymorphic case, ownership is determined by the _target_ table (e.g., `mealPlanRecipes.userId` or `communityRecipes.authorId`), not the junction table itself. Each consumer must check ownership through the appropriate target table based on the `recipeType` discriminator.

## Checklist for polymorphic FK consumers

1. **Toggle (add/remove):** Before inserting into the junction table, verify the target exists and is visible to the user. For `mealPlan` type: `eq(mealPlanRecipes.userId, userId)`. For `community` type: `and(eq(communityRecipes.id, recipeId), or(eq(communityRecipes.isPublic, true), eq(communityRecipes.authorId, userId)))` — community recipes can be private, so the visibility guard is required, not just existence.
2. **Resolve (batch fetch details):** When fetching target rows by ID, include `eq(target.userId, userId)` in the WHERE clause (for private types) or `or(eq(isPublic, true), eq(authorId, userId))` (for public/private mixed types).
3. **Share:** When building a share payload, filter by `or(eq(isPublic, true), eq(authorId, userId))` — never expose private community recipes.
4. **Count:** Use EXISTS subqueries or proactive orphan cleanup to ensure counts exclude deleted targets (see "Orphan-Safe Counts" in database patterns).
5. **Legacy/fallback lookup paths:** Any secondary code path that resolves a recipe by ID (e.g., a fallback branch when the primary discriminator lookup fails) must apply the same ownership check as the primary path. A fallback that skips the `userId` filter is a full IDOR regardless of how rarely it executes.

## Examples

```typescript
// ❌ Bad: Toggle accepts any recipeId without checking who owns it
async function toggleFavourite(
  userId: string,
  recipeId: number,
  recipeType: string,
) {
  return db.transaction(async (tx) => {
    // ... toggle logic using recipeId directly — IDOR!
  });
}

// ✅ Good: Verify ownership of the target recipe before toggling
async function toggleFavourite(
  userId: string,
  recipeId: number,
  recipeType: string,
) {
  return db.transaction(async (tx) => {
    if (recipeType === "mealPlan") {
      const [recipe] = await tx
        .select({ id: mealPlanRecipes.id })
        .from(mealPlanRecipes)
        .where(
          and(
            eq(mealPlanRecipes.id, recipeId),
            eq(mealPlanRecipes.userId, userId),
          ),
        );
      if (!recipe) return undefined; // Not found or not owned
    }
    // ... toggle logic
  });
}
```

## Why

The junction table _does_ have `userId`, so it looks like ownership is enforced. But the `userId` on the junction only tracks who favourited — it does not prove the target recipe is accessible to that user. A malicious user can favourite another user's private meal plan recipe by guessing the ID.

## Related Files

- `server/storage/favourite-recipes.ts` — toggle, resolve, share, count all verify target ownership
- `server/storage/cookbooks.ts` — similar polymorphic FK pattern with same risk
- Audit #9 H1, H2

## See Also

- [IDOR protection: auth + ownership check](idor-protection-auth-ownership-check-2026-05-13.md)
- [Storage-layer defense-in-depth for IDOR](storage-layer-idor-defense-in-depth-2026-05-13.md)
