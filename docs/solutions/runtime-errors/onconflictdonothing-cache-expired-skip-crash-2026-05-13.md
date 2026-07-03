---
title: onConflictDoNothing on cache tables causes expired-entry skip + ! crash
track: bug
category: runtime-errors
module: server
severity: high
tags: [drizzle, cache, on-conflict, ttl, non-null-assertion]
symptoms: [Cache refresh appears to succeed but the TTL'd row never changes, Non-null assertion (`!`) crashes the request on cache refresh, Cache table holds an expired row that no new write can overwrite]
applies_to: [server/storage/**/*.ts]
created: '2026-04-28'
---

# onConflictDoNothing on cache tables causes expired-entry skip + ! crash

## Problem

`createMealSuggestionCache` used `onConflictDoNothing`. When an expired cache entry already existed with the same key, the insert was silently skipped (conflict on the unique index). The caller then called `getMealSuggestionCache`, which filtered the expired entry out (TTL check), returning `undefined`. The function then did `return existing!` — non-null assertion on an `undefined` value — crashing the request.

## Symptoms

- Cache refresh path crashes intermittently for users with old data
- `getMealSuggestionCache` returns `undefined` even though the unique key has a row
- The unique key has an expired row that no `INSERT` can replace

## Root Cause

`onConflictDoNothing` is correct for idempotent inserts where the first write wins (e.g., `addFavourite`), but wrong for cache tables where an expired entry must be refreshed. The DO NOTHING branch silently skips the write, leaving the stale row in place. The downstream TTL check filters it out, but the non-null assertion assumes the write succeeded.

## Solution

Use `onConflictDoUpdate` with `set: { suggestions, expiresAt }` to atomically refresh the row:

```typescript
// Bad — cache write silently no-ops on existing expired row
await db
  .insert(mealSuggestionCache)
  .values({ key, suggestions, expiresAt })
  .onConflictDoNothing();

// Good — atomically refresh the row
await db
  .insert(mealSuggestionCache)
  .values({ key, suggestions, expiresAt })
  .onConflictDoUpdate({
    target: mealSuggestionCache.key,
    set: { suggestions, expiresAt },
  });
```

## Prevention

Cache tables must use `onConflictDoUpdate` (not `onConflictDoNothing`) so that expired entries are refreshed rather than silently skipped. Audit every storage function that writes to a TTL'd cache table and verify the conflict strategy refreshes the row.

Also: avoid trailing non-null assertions on values that came from a query that may legitimately return `undefined`. Prefer an explicit null check + meaningful error.

## Related Files

- `server/storage/meal-suggestions-cache.ts`
- Audit 2026-04-28 H3

## See Also

- [Upsert with onConflictDoUpdate](../design-patterns/upsert-with-onconflictdoupdate-2026-05-13.md)
- [Defensive cache writes onconflictdonothing](../conventions/defensive-cache-writes-onconflictdonothing-2026-05-13.md)
