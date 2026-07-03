---
title: 'Dual-assertion IDOR test: return value AND database state'
track: knowledge
category: best-practices
module: server
tags: [testing, idor, security, integration-tests, drizzle]
applies_to: [server/storage/**/__tests__/**/*.ts]
created: '2026-05-13'
---

# Dual-assertion IDOR test: return value AND database state

## When this applies

When writing integration tests for functions that enforce cross-user data ownership, assert **both** the return value and the database state. Return value alone cannot catch a bug where the function returns `null` but still commits a side-effect write — two independent failure modes require two independent checks.

This is the verification counterpart to the storage-layer IDOR rule (binding rule in `docs/rules/testing.md`: _Dual-Assertion IDOR test pattern: (1) assert correct user gets data, (2) assert different user gets nothing — both in the same test suite_).

## Why

A storage function that fails IDOR checks can leak data in two distinct ways:

1. **API-contract failure** — returns the wrong row to the wrong user
2. **Data-integrity failure** — silently writes to the database for the forged ID even though the return is `null`

Each failure mode needs its own assertion. A test that only checks the return value misses the side-effect write; a test that only checks the database state misses the API contract.

## Examples

### Write path — assert no new row was written

```typescript
it("returns null when conversationId is owned by a different user", async () => {
  const otherUser = await createTestUser(tx);
  const conv = await createChatConversation(
    otherUser.id,
    "Other Chat",
    "recipe",
  );
  const msg = await createChatMessage(
    conv.id,
    otherUser.id,
    "assistant",
    "Recipe!",
    metadata,
  );

  const result = await saveRecipeFromChat(msg.id, conv.id, testUser.id);

  // 1. API contract: caller must be told the operation failed
  expect(result).toBeNull();

  // 2. Data integrity: nothing must have been written for the forged ID
  const leaked = await tx
    .select()
    .from(communityRecipes)
    .where(eq(communityRecipes.sourceMessageId, msg.id));
  expect(leaked).toHaveLength(0);
});
```

### Read-only path — assert the target row was not mutated

When the guarded code path is read-only (SELECT only), there is no new row to check. Instead, confirm the target row's ownership fields are unchanged — this rules out an unintended mutation:

```typescript
// Legacy savedRecipeId path — SELECT only, no INSERT
it("returns null when legacy savedRecipeId references another user's recipe (IDOR)", async () => {
  // ...setup: otherUser owns otherRecipe, testUser forges the savedRecipeId...
  const result = await saveRecipeFromChat(msg.id, conv.id, testUser.id);
  expect(result).toBeNull();

  // Confirm read-only path left the target row untouched
  const [afterAttempt] = await tx
    .select()
    .from(communityRecipes)
    .where(eq(communityRecipes.id, otherRecipe.id));
  expect(afterAttempt).toBeDefined();
  expect(afterAttempt!.authorId).toBe(otherUser.id);
});
```

### `onConflictDoNothing` idempotency tests — name the conflict key

When pre-inserting a row to trigger `onConflictDoNothing`, add a comment naming the unique constraint that fires. Without it, a reader must trace through the implementation to know whether the conflict key is `sourceMessageId`, `normalizedProductName`, or something else — and if the wrong field was pre-populated, the conflict never triggers and the test silently covers the wrong branch.

```typescript
// The unique constraint that fires is on sourceMessageId (confirmed by
// the fallback SELECT in recipe-from-chat.ts:118). normalizedProductName
// is recipe.title.toLowerCase() = "test-chicken salad" — matches here.
const [preInserted] = await tx
  .insert(communityRecipes)
  .values({
    normalizedProductName: "test-chicken salad",
    sourceMessageId: msg.id, // ← conflict key
    // ...
  })
  .returning();
```

## Exceptions

- Route-level tests with mocked storage — the mock already prevents DB writes, so a DB state assertion would be vacuously true
- Non-security behaviors where the return value fully characterizes the outcome

## Related Files

- `server/storage/__tests__/chat.test.ts` — `saveRecipeFromChat` IDOR tests (H9): write-path and read-path variants
- `server/storage/__tests__/coach-notebook.test.ts` — `getNotebookEntryById` IDOR test (M5)
- `docs/rules/testing.md` — Dual-Assertion IDOR test pattern (binding one-liner)

## See Also

- [Storage integration tests with transaction rollback](../design-patterns/storage-integration-tests-transaction-rollback-2026-05-13.md)
- [Storage-layer defense-in-depth for IDOR](../conventions/storage-layer-idor-defense-in-depth-2026-05-13.md)
