---
title: Transactions in the storage layer
track: knowledge
category: conventions
module: server
tags: [database, drizzle, transactions, architecture, storage]
applies_to: [server/storage/**/*.ts, server/routes/**/*.ts]
created: '2026-05-13'
---

# Transactions in the storage layer

## Rule

All `db.transaction()` calls belong in **storage modules** (`server/storage/*.ts`), never in routes. Routes call named storage functions that encapsulate the transaction internally.

## Examples

```typescript
// ✅ Good: Named storage function with transaction inside
// server/storage/nutrition.ts
export async function createScannedItemWithLog(
  item: InsertScannedItem,
  logOverrides?: Partial<Pick<InsertDailyLog, "mealType" | "source">>,
): Promise<ScannedItem> {
  return db.transaction(async (tx) => {
    const [scannedItem] = await tx.insert(scannedItems).values(item).returning();
    await tx.insert(dailyLogs).values({
      userId: item.userId,
      scannedItemId: scannedItem.id,
      servings: "1",
      mealType: logOverrides?.mealType ?? null,
      source: logOverrides?.source ?? "scan",
    });
    return scannedItem;
  });
}

// Route calls it cleanly:
const item = await storage.createScannedItemWithLog(
  { userId: req.userId!, productName, calories: calories.toString(), ... },
  { mealType: validated.mealType || null },
);
```

```typescript
// ❌ Bad: Transaction in route — bypasses storage abstraction
import { db } from "../db";
import { scannedItems, dailyLogs } from "@shared/schema";

const item = await db.transaction(async (tx) => {
  const [scannedItem] = await tx.insert(scannedItems).values({...}).returning();
  await tx.insert(dailyLogs).values({ scannedItemId: scannedItem.id, ... });
  return scannedItem;
});
```

```typescript
// ❌ Bad: Generic transaction wrapper — adds indirection with no domain meaning
async function withTransaction<T>(
  cb: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return await db.transaction(cb);
}
```

## Why

- **Routes must not import `db`** — all database access goes through the storage facade (see architecture pattern)
- **Reuse** — when 5 routes need the same "insert item + log" transaction, a named storage function eliminates duplication
- **Testability** — route tests mock `storage.createScannedItemWithLog()` (one line) instead of building fake transaction objects with nested `insert/values/returning` chains
- **Storage-level tests** can verify the actual transaction logic against a real database

## When to use

Any multi-table write that must be atomic. Give the function a descriptive domain name (`createScannedItemWithLog`, `upsertProfileWithOnboarding`, `createMealPlanFromSuggestions`).

## Exceptions

Don't create generic transaction wrappers (`withTransaction`, `runInTx`) — they add indirection without domain meaning.

## Related Files

- `server/storage/nutrition.ts` — `createScannedItemWithLog()` (5 route callers)
- `server/storage/users.ts` — `upsertProfileWithOnboarding()`
- `server/storage/meal-plans.ts` — `createMealPlanFromSuggestions()`
- `server/storage/nutrition.ts` — `softDeleteScannedItem()`, `toggleFavouriteScannedItem()` (existing examples)
