---
title: Defensive cache writes with onConflictDoNothing
track: knowledge
category: conventions
module: server
tags: [database, cache, drizzle, on-conflict, security, poisoning]
applies_to: [server/services/**/*.ts, server/storage/**/*.ts]
created: '2026-05-13'
---

# Defensive cache writes with onConflictDoNothing

## Rule

Use `onConflictDoNothing` (not `onConflictDoUpdate`) when seeding a cache from user-provided data to prevent cache poisoning.

## Examples

```typescript
// GOOD: only insert if no entry exists — never overwrite trusted data
await db
  .insert(nutritionCache)
  .values({ queryKey: key, data, expiresAt })
  .onConflictDoNothing({ target: nutritionCache.queryKey });

// BAD: overwrites existing data — any user can poison the cache
await db
  .insert(nutritionCache)
  .values({ queryKey: key, data, expiresAt })
  .onConflictDoUpdate({
    target: nutritionCache.queryKey,
    set: { data, expiresAt },
  });
```

## When to use

When user-submitted data (e.g., label scans with arbitrary barcode strings) could overwrite authoritative cached data. The user provides the cache key (barcode), which they can set to anything.

## Exceptions

When the system is the sole writer and updates are intentional (e.g., refreshing expired cache from a trusted API).

## Related Files

- `server/services/nutrition-lookup.ts` — `cacheNutritionIfAbsent()` guards label-confirm cache seeding
- Security finding from PR #14 code review

## See Also

- [Unique index + onConflictDoUpdate for AI cache dedup](../design-patterns/unique-index-onconflictdoupdate-ai-cache-dedup-2026-05-13.md)
- [Upsert with onConflictDoUpdate](../design-patterns/upsert-with-onconflictdoupdate-2026-05-13.md)
