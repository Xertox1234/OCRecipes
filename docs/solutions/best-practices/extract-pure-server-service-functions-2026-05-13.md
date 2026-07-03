---
title: Extract pure server-service functions for focused unit tests
track: knowledge
category: best-practices
module: server
tags: [testing, vitest, server, pure-functions, services]
applies_to: [server/services/**/*.ts, server/services/**/__tests__/**/*.ts]
created: '2026-05-13'
---

# Extract pure server-service functions for focused unit tests

## When this applies

When server-side business logic is complex enough to warrant thorough unit testing, extract it into a pure function in its own service file. The function takes plain data in and returns plain data out, with no database access, no `req`/`res` objects, and no side effects.

## Why

Unlike the client-side pattern (which exists because Vitest cannot import React Native modules), the server-side pattern exists for **design clarity** and **test coverage** — the functions _could_ be tested in-place, but extracting them makes the test file focused and the function's contract explicit.

## Examples

```
# File structure
server/services/
  pantry-deduction.ts           # Pure function — no DB, no Express, fully testable
  __tests__/
    pantry-deduction.test.ts    # 9 test cases covering edge cases
```

```typescript
// server/services/pantry-deduction.ts — Pure function, no DB access
import type { PantryItem } from "@shared/schema";
import type { AggregatedGroceryItem } from "./grocery-generation";

function normalizeName(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, " ");
}

export function deductPantryFromGrocery(
  groceryItems: AggregatedGroceryItem[],
  pantryItems: PantryItem[],
): AggregatedGroceryItem[] {
  // Build lookup map, subtract quantities, filter out fully covered items
  // No DB calls — caller fetches data and passes it in
}
```

```typescript
// Route handler — fetches data, calls pure function, returns result
app.post("/api/meal-plan/grocery-lists", requireAuth, async (req, res) => {
  const groceryItems = await generateGroceryItems(recipes);
  const pantryItems = features.pantryTracking
    ? await storage.getPantryItems(req.userId!)
    : [];
  const deducted = deductPantryFromGrocery(groceryItems, pantryItems);
  // ... save and return
});
```

## When to use

- Complex transformation logic with multiple edge cases (unit conversions, matching, deduction)
- Logic that benefits from 5+ unit tests covering boundary conditions
- Server-side logic that does not need database access

## Exceptions

- Simple CRUD operations where the logic is trivial
- Logic tightly coupled to database queries (keep in storage methods)

## Related Files

- `server/services/pantry-deduction.ts` — `deductPantryFromGrocery()` with 9 unit tests
- `client/lib/iap/purchase-utils.ts` — client-side equivalent

## See Also

- [Extract pure functions to `*-utils.ts` for Vitest testability](extract-pure-functions-for-vitest-testability-2026-05-13.md)
