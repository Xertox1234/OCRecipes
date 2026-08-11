---
title: Fire-and-forget for non-critical background operations
track: knowledge
category: design-patterns
module: server
tags: [api, routes, database, async, background, error-handling, performance]
applies_to: [server/routes/**/*.ts, server/storage/**/*.ts, server/services/**/*.ts]
created: '2026-05-13'
---

# Fire-and-forget for non-critical background operations

## When this applies

When an operation shouldn't block the response but failure should be logged, use the `fireAndForget` helper from `server/lib/fire-and-forget.ts`.

## Examples

```typescript
import { fireAndForget } from "../lib/fire-and-forget";

// Good: Fire-and-forget with labeled error logging
fireAndForget("cache-hit-increment", storage.incrementCacheHit(cached.id));
fireAndForget(
  "suggestion-cache-invalidation",
  storage.invalidateCacheForUser(userId),
);
fireAndForget("instruction-cache-write", storage.createCacheEntry(data));

// Response sent immediately, background operation continues
return res.json({ data });
```

```typescript
// Bad: Awaiting non-critical operations delays response
await storage.incrementCacheHit(cached.id);
await storage.invalidateCacheForUser(userId);
return res.json({ data }); // User waited for analytics
```

## Why

Without a catch, unhandled promise rejections can crash Node.js in strict mode. The helper logs failures with a context label for easier debugging while not blocking the response.

## When to use

- Analytics and hit count tracking
- Cache writes after generating response
- Eager cache invalidation
- Audit logging
- Slow post-response work: image/asset generation (5–30s), search index updates, email/notification sending, webhook fan-out
- Any operation where:
  - Failure doesn't affect the current request's correctness
  - The user shouldn't wait for completion

For fields the background work will fill in later (e.g. a recipe's `imageUrl`), return `null` in the immediate response so the client knows the data is pending and can poll or refetch.

## Exceptions

- Operations that must succeed before responding (auth, critical writes)
- Operations where failure affects response correctness
- Multi-step transactions where rollback is needed

## Related Files

- `server/lib/fire-and-forget.ts` — helper implementation
- `server/services/recipe-generation.ts` — `generateAndPatchRecipeImage`, fired after the recipe-creation response

## See Also

- [Cache-first pattern for expensive operations](cache-first-pattern-expensive-operations-2026-05-13.md)
- [Side-effect ordering around db.transaction](../conventions/side-effect-ordering-around-db-transaction-2026-05-13.md)
- [Atomic server endpoints over multi-request client flows](atomic-server-endpoints-over-multi-request-2026-05-13.md) — the opposite call: critical mutations belong in the transaction, never fired-and-forgotten
