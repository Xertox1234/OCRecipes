---
title: Transaction-wrapped count-then-insert to prevent TOCTOU
track: knowledge
category: design-patterns
module: server
tags: [database, drizzle, transactions, toctou, rate-limit, race-condition]
applies_to: [server/storage/**/*.ts]
created: '2026-05-13'
---

# Transaction-wrapped count-then-insert to prevent TOCTOU

## When this applies

When a storage method enforces a per-user limit (max saved items, max sessions, max grocery lists), wrap the count query and the insert in a single `db.transaction()`. Without this, two concurrent requests can both pass the count check and both insert, exceeding the limit.

## Examples

```typescript
// ✅ GOOD: Count + insert in one transaction — second request sees the first's insert
export async function createSavedItem(
  userId: string,
  itemData: CreateSavedItemInput,
): Promise<SavedItem | null> {
  return db.transaction(async (tx) => {
    const countResult = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(savedItems)
      .where(eq(savedItems.userId, userId));
    const count = countResult[0]?.count ?? 0;

    // Read tier inside the same transaction for consistency
    const [subRow] = await tx
      .select({ tier: users.subscriptionTier })
      .from(users)
      .where(eq(users.id, userId));
    const tier = isValidSubscriptionTier(subRow?.tier) ? subRow.tier : "free";
    const limit = TIER_FEATURES[tier].maxSavedItems;

    if (count >= limit) return null; // Signal limit reached

    const [item] = await tx
      .insert(savedItems)
      .values({ ...itemData, userId })
      .returning();
    return item;
  });
}

// ❌ BAD: Separate count and insert — race condition on concurrent requests
export async function createSavedItem(userId: string, itemData: CreateSavedItemInput) {
  const count = await getSavedItemCount(userId); // Not in a transaction
  if (count >= limit) return null;
  const [item] = await db.insert(savedItems).values({ ... }).returning(); // Another request may have inserted between count and here
  return item;
}
```

## When to use

- Any storage method that checks a count/existence before inserting (saved items, grocery lists, meal plan items, API keys)
- Any "check then act" pattern where concurrent requests could both pass the check

## Exceptions

- Operations where over-limit insertion is harmless and can be cleaned up later
- Unique constraints that already prevent duplicates (use `onConflictDoNothing` instead)

## Related Files

- `server/storage/nutrition.ts` — `createSavedItem()` with tier-limit check
- `server/storage/users.ts` — `createTransactionAndUpgrade()` (atomic transaction + tier update)
- `server/storage/chat.ts` — `createChatMessageWithLimitCheck()` (limit check + message insert + conversation timestamp)
- `server/storage/community.ts` — `createRecipeWithLimitCheck()` (limit check + recipe + generation log)
- `server/storage/meal-plans.ts` — `createGroceryListWithLimitCheck()` (limit check + list + items)
- `server/storage/medication.ts` — `applyAdaptiveGoalsAtomically()`, `dismissAdaptiveGoalsAtomically()`
- `server/storage/users.ts` — `createWeightLogAndUpdateUser()` (weight log + user weight update)

## See Also

- [Early non-transactional check + authoritative transactional check](early-non-transactional-authoritative-transactional-check-2026-05-13.md) (for the two-phase variant)
- [Unique constraint as TOCTOU safety net](unique-constraint-toctou-safety-net-2026-05-13.md)
- [Advisory lock for per-user rate limiting](advisory-lock-per-user-rate-limiting-2026-05-13.md)
