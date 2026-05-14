---
title: "Early non-transactional check + authoritative transactional check"
track: knowledge
category: design-patterns
tags: [database, drizzle, transactions, ai, toctou, performance]
module: server
applies_to: ["server/routes/**/*.ts", "server/storage/**/*.ts"]
created: 2026-05-13
---

# Early non-transactional check + authoritative transactional check

## When this applies

When an expensive operation (AI generation, external API call) sits between the limit check and the insert, use a two-phase approach: a fast non-transactional check before the expensive work, and an authoritative transactional check-then-insert after it. This avoids holding a database transaction open during a multi-second AI call while still preventing TOCTOU races.

## Examples

```typescript
// server/routes/recipes.ts — recipe generation with AI call

// Phase 1: Fast non-transactional check (avoids expensive AI call for clearly over-limit users)
const generationsToday = await storage.getDailyRecipeGenerationCount(userId, new Date());
if (generationsToday >= features.dailyRecipeGenerations) {
  return sendError(res, 429, "Daily recipe generation limit reached");
}

// Phase 2: Expensive AI call (NOT inside a transaction)
const generatedRecipe = await generateFullRecipe({ productName, ... });

// Phase 3: Authoritative transactional check + insert (prevents TOCTOU race)
const recipe = await storage.createRecipeWithLimitCheck(
  userId,
  features.dailyRecipeGenerations,
  { title: generatedRecipe.title, ... },
);

if (!recipe) {
  // Another request snuck in while we were generating
  return sendError(res, 429, "Daily recipe generation limit reached");
}
```

```typescript
// server/storage/community.ts — atomic storage method
export async function createRecipeWithLimitCheck(
  userId: string,
  dailyLimit: number,
  data: InsertCommunityRecipe,
): Promise<CommunityRecipe | null> {
  return db.transaction(async (tx) => {
    const { startOfDay, endOfDay } = getDayBounds(new Date());
    const result = await tx
      .select({ count: sql<number>`count(*)` })
      .from(recipeGenerationLog)
      .where(
        and(
          eq(recipeGenerationLog.userId, userId),
          gte(recipeGenerationLog.generatedAt, startOfDay),
          lt(recipeGenerationLog.generatedAt, endOfDay),
        ),
      );
    if (Number(result[0]?.count ?? 0) >= dailyLimit) return null;

    const [recipe] = await tx.insert(communityRecipes).values(data).returning();
    await tx
      .insert(recipeGenerationLog)
      .values({ userId, recipeId: recipe.id });
    return recipe;
  });
}
```

## Key elements

1. **Phase 1 (fast path):** Non-transactional count check rejects obviously over-limit requests immediately, saving the cost of the AI call
2. **Phase 2 (expensive work):** AI generation runs outside any transaction so the DB connection is not held open
3. **Phase 3 (authoritative):** Re-checks the limit inside `db.transaction()` and inserts atomically, preventing the race
4. **Return `null` for limit-reached:** Caller checks the return value and sends the appropriate error response

## When to use

- Any endpoint where an expensive operation (AI, external API, image processing) precedes a rate-limited insert
- Used in: recipe generation, meal suggestions, chat messages, grocery list creation

## Exceptions

- When there is no expensive work between the check and the insert (use the simpler single-transaction pattern above)
- When the non-transactional fast-path check is not worth the code complexity (low-traffic endpoints)

## Related Files

- `server/routes/recipes.ts` — `createRecipeWithLimitCheck()` (AI recipe generation)
- `server/routes/meal-suggestions.ts` — `createMealSuggestionCacheWithLimitCheck()` (AI meal suggestions)
- `server/routes/chat.ts` — `createChatMessageWithLimitCheck()` (chat daily limit)
- `server/routes/grocery.ts` — `createGroceryListWithLimitCheck()` (grocery list count)

## See Also

- [Transaction-wrapped count-then-insert to prevent TOCTOU](transaction-wrapped-count-then-insert-toctou-2026-05-13.md)
- [Advisory lock for per-user rate limiting](advisory-lock-per-user-rate-limiting-2026-05-13.md)
