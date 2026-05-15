---
title: "Receipt-to-meal-plan route saved partial data without a transaction"
track: bug
category: logic-errors
tags: [transactions, error-handling, api, mutation-hooks, mealplan]
module: server
applies_to:
  ["server/routes/meal-plan.ts", "client/hooks/useGenerateMealPlan.ts"]
symptoms:
  - "Failed batch save leaves some recipes persisted and others missing"
  - "Custom user-facing error messages never appear; users see raw '500: {error: ...}'"
  - "Internal OpenAI/database errors leak into the 5xx response body"
created: 2026-03-10
severity: high
---

# Receipt-to-meal-plan route saved partial data without a transaction

## Problem

The new `/api/meal-plan/generate-from-pantry` and `/save-generated` endpoints exposed three bugs in one review: dead `if (!res.ok)` checks in the client mutation hooks (because `apiRequest()` already throws on non-OK), an internal `error.message` forwarded directly in the 500 response, and a batch save loop that ran outside `db.transaction()` so a mid-loop failure left items 1-4 persisted with items 5-10 missing.

## Symptoms

- User sees `"500: {\"error\":\"OpenAI rate limit exceeded\"}"` instead of "Meal plan generation failed"
- Retrying after a partial save creates duplicate recipes
- Save endpoint returns 500 but some rows are already in the DB

## Root Cause

1. **`apiRequest()` throws on non-OK.** `throwIfResNotOk()` runs inside `apiRequest` before it returns. Any `if (!res.ok)` branch after the call is dead code.
2. **`error.message` exposes internals.** Every other 500 handler in the file uses a fixed generic string. Forwarding `error.message` can leak OpenAI/database error text to end users.
3. **No transaction around multi-table writes.** Sequential `storage.createRecipe` + `storage.createMealPlanItem` calls in a loop produce partial state on failure.

## Solution

1. Remove dead `if (!res.ok)` blocks. Mutations now just call `apiRequest()` and `return res.json()`.

2. Replace dynamic `error.message` with a fixed string in the 500 handler:

```typescript
} catch (err) {
  console.error("generate-from-pantry failed", err);
  return res.status(500).json({ error: "Failed to generate meal plan" });
}
```

3. Wrap the batch save in `db.transaction()` using `tx.insert()` directly:

```typescript
await db.transaction(async (tx) => {
  for (const item of items) {
    const [recipe] = await tx.insert(recipes).values(item.recipe).returning();
    await tx.insert(mealPlanItems).values({ recipeId: recipe.id, ... });
  }
});
```

## Prevention

- `apiRequest` is throw-on-error. Never re-check `res.ok` after calling it.
- 500 catch blocks must use fixed strings. Never forward `error.message`.
- Multi-table writes need `db.transaction()`. If a route loop calls multiple storage methods per iteration, refactor to a transaction with direct `tx.*` operations.

## Related Files

- `server/routes/meal-plan.ts` — `generate-from-pantry` and `save-generated` endpoints
- `client/hooks/useGenerateMealPlan.ts`

## See Also

- [apiRequest never returns non-OK — don't re-check res.ok](../code-quality/api-request-never-returns-non-ok-dead-code-2026-05-13.md)
- [Generic error messages for 5xx](../conventions/generic-error-messages-5xx-2026-05-13.md)
- [Transactions in storage layer](../conventions/transactions-in-storage-layer-2026-05-13.md)
