---
title: Lightweight ownership verification for mutations
track: knowledge
category: design-patterns
module: server
tags: [security, idor, storage, performance, mutations]
applies_to: [server/routes/**/*.ts, server/storage/**/*.ts]
created: '2026-05-13'
---

# Lightweight ownership verification for mutations

## When this applies

Mutation endpoints (PUT, PATCH, DELETE) that only need to confirm the resource belongs to the user should use a lightweight ownership query — not fetch the full entity with all relations.

Use when the handler doesn't use the fetched data for its logic (e.g., toggling a boolean, adding a child item).

## When NOT to use

Read endpoints or mutations where the handler needs the fetched data (e.g., add-to-pantry needs the grocery item details).

## Examples

```typescript
// ❌ Bad: Fetches full list + all items just to check ownership
const list = await storage.getGroceryListWithItems(listId, req.userId);
if (!list) return sendError(res, 404, ...);
// ... handler never uses list.items

// ✅ Good: Lightweight boolean check
const ownsList = await storage.verifyGroceryListOwnership(listId, req.userId);
if (!ownsList) return sendError(res, 404, ...);
```

The storage function selects only the ID:

```typescript
export async function verifyGroceryListOwnership(
  id: number,
  userId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: groceryLists.id })
    .from(groceryLists)
    .where(and(eq(groceryLists.id, id), eq(groceryLists.userId, userId)));
  return !!row;
}
```

## Why

Fetching joined relations just to confirm ownership wastes DB work and network round-trips. A primary-key + userId boolean check is one indexed lookup. The ownership guarantee is identical.

## Related Files

- `server/storage/meal-plans.ts` — `verifyGroceryListOwnership`
- Audit #6 H3

## See Also

- [IDOR protection: auth + ownership check](../conventions/idor-protection-auth-ownership-check-2026-05-13.md)
- [Storage-layer defense-in-depth for IDOR](../conventions/storage-layer-idor-defense-in-depth-2026-05-13.md)
