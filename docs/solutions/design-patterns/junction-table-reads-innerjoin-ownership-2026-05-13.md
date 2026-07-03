---
title: 'Junction table reads: innerJoin through parent for ownership'
track: knowledge
category: design-patterns
module: server
tags: [security, idor, drizzle, joins, junction-tables]
applies_to: [server/storage/**/*.ts]
created: '2026-05-13'
---

# Junction table reads: innerJoin through parent for ownership

## When this applies

Any read from a child/junction table where the child row's ownership is determined by its parent (cookbook recipes, grocery list items, recipe ingredients) — i.e., the junction table has **no `userId` column**.

## When NOT to use

Child tables that have their own `userId` column — filter directly on the child.

## Examples

```typescript
// ❌ Bad: Junction table read with no ownership check
export async function getCookbookRecipes(
  cookbookId: number,
): Promise<CookbookRecipe[]> {
  return db
    .select()
    .from(cookbookRecipes)
    .where(eq(cookbookRecipes.cookbookId, cookbookId)) // Any user's cookbookId works!
    .orderBy(desc(cookbookRecipes.addedAt));
}

// ✅ Good: Join through parent to verify ownership
export async function getCookbookRecipes(
  cookbookId: number,
  userId: string,
): Promise<CookbookRecipe[]> {
  const rows = await db
    .select({ recipe: cookbookRecipes })
    .from(cookbookRecipes)
    .innerJoin(cookbooks, eq(cookbookRecipes.cookbookId, cookbooks.id))
    .where(
      and(
        eq(cookbookRecipes.cookbookId, cookbookId),
        eq(cookbooks.userId, userId), // Ownership enforced via parent
      ),
    )
    .orderBy(desc(cookbookRecipes.addedAt));
  return rows.map((r) => r.recipe);
}
```

## Why

A route calling this function may verify ownership separately (e.g., `getCookbook(id, userId)` before `getCookbookRecipes(id)`). But if a future code path calls the read function directly with an untrusted `cookbookId`, it would leak another user's data. The `innerJoin` approach makes the storage function independently safe with minimal overhead — the join uses the parent's primary key index.

## Related Files

- `server/storage/cookbooks.ts` — `getCookbookRecipes(cookbookId, userId)`

## See Also

- [Storage-layer defense-in-depth for IDOR](../conventions/storage-layer-idor-defense-in-depth-2026-05-13.md) (the parent pattern for direct-owned tables)
- [IDOR protection: auth + ownership check](../conventions/idor-protection-auth-ownership-check-2026-05-13.md)
