---
title: Atomic server endpoints over multi-request client flows
track: knowledge
category: design-patterns
module: server
tags: [api, transactions, atomicity, routes, race-conditions]
applies_to: [server/routes/**/*.ts]
created: '2026-05-13'
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

## Variant: flag-on-create

When step 2 merely sets a flag on the resource step 1 creates (generate → share), fold the flag into the creation request instead of a follow-up call:

```typescript
// Bad: two-step — recipe exists but stays private if the share call never lands
POST /api/recipes            → { id: "r123", isPublic: false }
POST /api/recipes/r123/share → { isPublic: true }

// Good: atomic flag in the creation schema
POST /api/recipes { title: "...", shareToPublic: true }
// server sets isPublic inside the creation transaction
```

Add the flag to the shared zod schema (`shareToPublic: z.boolean().optional()`), set the column inside the creation transaction, and delete the second client request. (Origin: audit finding M1, 2026-04-26.)

## Key benefits

1. **Atomicity** — both operations succeed or fail together (use `db.transaction()` if strict DB atomicity is needed)
2. **Fewer round trips** — one HTTP request instead of two
3. **Simpler client code** — single mutation hook with single invalidation
4. **No partial state** — UI never shows "added to pantry" without the grocery flag being set

## When to use

- Two or more writes that are logically one user action (check off + add to pantry, confirm meal + create daily log)
- Generate + share, create + enable, upload + process — any creation whose follow-up flag belongs in the creation request (flag-on-create variant)
- When partial failure would leave the UI in an inconsistent state
- When the client would need to coordinate rollback logic

## Exceptions

- Independent operations that the user performs separately
- Read-then-write patterns where the read result determines the write (use optimistic updates instead)

## Related Files

- `server/routes.ts` — `POST /api/meal-plan/grocery-lists/:id/items/:itemId/add-to-pantry`
- `client/hooks/useGroceryList.ts` — `useAddGroceryItemToPantry` mutation
- `shared/schemas/recipe.ts` — `recipeGenerationSchema` with `shareToPublic` (flag-on-create)

## See Also

- [Fire-and-forget for non-critical background operations](fire-and-forget-non-critical-background-2026-05-13.md)
