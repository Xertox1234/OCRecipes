---
title: "Atomic server endpoints over multi-request client flows"
track: knowledge
category: design-patterns
tags: [api, transactions, atomicity, routes, race-conditions]
module: server
applies_to: ["server/routes/**/*.ts"]
created: 2026-05-13
---

# Atomic server endpoints over multi-request client flows

## When this applies

When a client action requires multiple related mutations (e.g., create a record + update a flag on another record), create a single server endpoint that performs both operations atomically rather than having the client make multiple sequential requests.

## Why

Two-step client flows leave a race window where one mutation succeeds and the other fails. The UI then shows partial state ("added to pantry" without the grocery flag being set) and the client has to coordinate rollback logic. A single atomic endpoint eliminates the window entirely.

## Examples

```typescript
// Bad: Client makes 2 requests that can leave data inconsistent if one fails
const addToPantry = async (item: GroceryItem) => {
  await apiRequest("POST", "/api/pantry", { name: item.name, ... });        // Step 1
  await apiRequest("PUT", `/api/grocery-items/${item.id}`, { addedToPantry: true }); // Step 2 - what if this fails?
};

// Good: Single atomic endpoint handles both operations
const addToPantry = async (listId: number, itemId: number) => {
  await apiRequest("POST", `/api/meal-plan/grocery-lists/${listId}/items/${itemId}/add-to-pantry`);
};

// Server handler — both operations succeed or fail together
app.post("/api/meal-plan/grocery-lists/:id/items/:itemId/add-to-pantry",
  requireAuth,
  async (req, res) => {
    // Verify ownership, create pantry item, flag grocery item — all in one handler
    const pantryItem = await storage.createPantryItem({ ... });
    await storage.updateGroceryItemFlag(listId, itemId, { addedToPantry: true });
    res.status(201).json(pantryItem);
  },
);
```

## Key benefits

1. **Atomicity** — both operations succeed or fail together (use `db.transaction()` if strict DB atomicity is needed)
2. **Fewer round trips** — one HTTP request instead of two
3. **Simpler client code** — single mutation hook with single invalidation
4. **No partial state** — UI never shows "added to pantry" without the grocery flag being set

## When to use

- Two or more writes that are logically one user action (check off + add to pantry, confirm meal + create daily log)
- When partial failure would leave the UI in an inconsistent state
- When the client would need to coordinate rollback logic

## Exceptions

- Independent operations that the user performs separately
- Read-then-write patterns where the read result determines the write (use optimistic updates instead)

## Related Files

- `server/routes.ts` — `POST /api/meal-plan/grocery-lists/:id/items/:itemId/add-to-pantry`
- `client/hooks/useGroceryList.ts` — `useAddGroceryItemToPantry` mutation

## See Also

- [Atomic operations in single request (no two-step race condition)](atomic-operations-single-request-2026-05-13.md)
- [Fire-and-forget background operations after response](fire-and-forget-background-operations-2026-05-13.md)
