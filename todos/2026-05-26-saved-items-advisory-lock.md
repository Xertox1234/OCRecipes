---
title: "Add advisory lock to createSavedItem to close the saved-items limit-bypass race"
status: backlog
priority: low
created: 2026-05-26
updated: 2026-05-26
assignee:
labels: [deferred, database]
github_issue:
---

# Add advisory lock to createSavedItem to close the saved-items limit-bypass race

## Summary

Acquire a per-user `pg_advisory_xact_lock` inside the `createSavedItem` transaction so the count read and the limited insert are atomic. Mirrors the lock already in place in `toggleFavouriteRecipe`. Closes a real limit-bypass race that the existing transaction wrapper does not protect against under PostgreSQL's default READ COMMITTED isolation.

## Background

Surfaced from the post-merge code review of PR-less /todo branches landed 2026-05-26 (favourite-recipe ownership-inside-tx + getEffectiveTierForUser helper). The review pressure-tested `createSavedItem` for symmetry with `toggleFavouriteRecipe` and found:

```ts
// server/storage/nutrition.ts:451
// Wrap the count + insert in a transaction to prevent TOCTOU race on the count.
return db.transaction(async (tx) => {
  const countResult = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(savedItems)
    .where(eq(savedItems.userId, userId));
  const count = countResult[0]?.count ?? 0;
  if (count >= limit) return null;
  const [item] = await tx
    .insert(savedItems)
    .values({ ...itemData, userId })
    .returning();
  return item;
});
```

The comment overstates what the transaction guarantees. Under READ COMMITTED, two concurrent requests for the same `userId` can both open their own transactions, both see `count = N`, both pass the limit check, and both insert — landing the user at `N + 2` saved items even when the free-tier limit is `N + 1`. A serializable isolation level would catch this, but the codebase uses the database default.

The sibling function `toggleFavouriteRecipe` already solves this with `SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 0))` as the first statement inside the transaction, serializing all concurrent toggles for the same user. The same pattern applies here.

**Predates these merges:** the gap existed before today's refactor — the migration to `getEffectiveTierForUser` only moved the tier read outside the tx, it did not introduce the race. But it made the asymmetry between `toggleFavouriteRecipe` (locked) and `createSavedItem` (unlocked) visible. The comment that claims TOCTOU protection should also be corrected to match what the lock actually does.

## Acceptance Criteria

- [ ] `createSavedItem` acquires `pg_advisory_xact_lock(hashtextextended(${userId}, 0))` as its first statement inside the transaction
- [ ] The misleading "prevent TOCTOU race on the count" comment is rewritten to describe what the lock actually serializes (concurrent saved-item inserts for the same user)
- [ ] Add a regression test that exercises two concurrent `createSavedItem` calls at the limit boundary and asserts only one succeeds — model it on whichever favourite-recipes test currently covers the analogous limit-bypass race (if no concurrency test exists for favourites either, a sequential happy-path + limit-rejection test is acceptable)
- [ ] Existing nutrition tests still pass; `npm run test:run` and `npm run check:types` clean

## Implementation Notes

- File: `server/storage/nutrition.ts` (`createSavedItem`, lines ~440-470).
- Reference implementation: `server/storage/favourite-recipes.ts:20-26` — exact statement: `await tx.execute(sql\`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 0))\`);`
- Reference pattern: `docs/solutions/design-patterns/recompute-aggregate-under-lock-2026-05-17.md` and `docs/rules/database.md` rule #23.
- Use `hashtextextended(userId, 0)` (64-bit), not `hashtext(userId)` (32-bit) — the 64-bit form eliminates the ~65k-user birthday-collision risk that L31 flagged in the favourite-recipes audit.
- Keep `getEffectiveTierForUser(userId)` outside the transaction — same reasoning as `favourite-recipes.ts:77-80` (pool-connection read is fresher than a tx snapshot when subscription state changes concurrently).
- Minimal change: one `tx.execute(...)` line + a corrected comment. Do not refactor the rest of the function.

## Dependencies

- None.

## Risks

- Low. Advisory locks are advisory (no schema impact), per-user, and released on transaction commit/rollback. Worst case for an incorrect implementation is that concurrent inserts serialize unnecessarily — performance only, no correctness regression.

## Updates

### 2026-05-26

- Initial creation (deferred from post-merge code review of 2026-05-26 /todo run; flagged as SUGGESTION-tier asymmetry with `toggleFavouriteRecipe`).
