---
title: PostgreSQL Cache Tables for AI-Generated Content
track: knowledge
category: design-patterns
module: server
tags: [caching, postgres, openai, ai-content, idor, invalidation, profile-hash]
applies_to: [server/storage/**/*.ts, server/services/**/*.ts, shared/schema.ts]
created: '2026-05-13'
---

# PostgreSQL Cache Tables for AI-Generated Content

## When this applies

You're caching the output of an expensive, deterministic-ish external call
(OpenAI suggestions, instructions, recommendations) where:

- Inputs include user-specific data (so the cache must be user-scoped).
- Inputs include the user's profile (so invalidation needs to be content-aware).
- Hits should be cheap and survive process restarts.
- Misses are slow (2-3s) and expensive (per-token API cost).

The pattern combines three concerns — schema, IDOR enforcement, and
invalidation — into a single coherent design.

## Why

Three failure modes the pattern eliminates:

1. **Cold-start churn.** In-memory caches lose every hit on deploy. AI
   responses cost too much to re-pay that bill every release.
2. **Cross-user data leaks.** If the cache key is just an entity ID, any
   authenticated user can read another user's cached content. Authentication
   ≠ authorization.
3. **Stale cache after profile changes.** A user updates their dietary
   restrictions; cached suggestions referencing the old profile would
   silently surface. Hash-based keys + eager delete close the gap.

Hit rate after one week in the OCRecipes deployment: ~85% for returning
users. Hit time ~5ms vs miss ~2000-3000ms.

## Examples

### Key design decisions

| Decision              | Choice                                        | Rationale                                                              |
| --------------------- | --------------------------------------------- | ---------------------------------------------------------------------- |
| Cache storage         | PostgreSQL table                              | Persistence across restarts, easy querying, cascade deletes            |
| Cache key             | (itemId, userId, profileHash)                 | Unique per user per item, invalidates on profile change                |
| TTL                   | 30 days                                       | AI content doesn't change; long TTL maximizes hit rate                 |
| Expiry check          | Inline in query (`gt(expiresAt, new Date())`) | Single round-trip, no separate cleanup job needed                      |
| Hit tracking          | Fire-and-forget                               | Doesn't block response, failure is non-critical                        |
| Invalidation strategy | Hash-based + eager delete                     | Hash detects content-affecting changes; eager delete on profile update |

### Schema

```typescript
// Parent cache: indexed on composite key (itemId + userId)
export const suggestionCache = pgTable(
  "suggestion_cache",
  {
    id: serial("id").primaryKey(),
    scannedItemId: integer("scanned_item_id").notNull(),
    userId: varchar("user_id").notNull(),
    profileHash: varchar("profile_hash", { length: 64 }).notNull(),
    suggestions: jsonb("suggestions").notNull(),
    hitCount: integer("hit_count").default(0),
    expiresAt: timestamp("expires_at").notNull(),
  },
  (table) => ({
    itemUserIdx: index().on(table.scannedItemId, table.userId),
    expiresAtIdx: index().on(table.expiresAt),
  }),
);

// Child cache: cascade delete from parent
export const instructionCache = pgTable("instruction_cache", {
  suggestionCacheId: integer("suggestion_cache_id")
    .references(() => suggestionCache.id, { onDelete: "cascade" })
    .notNull(),
  // ...
});
```

The `expiresAt` index supports a future cleanup job; the `(itemId, userId)`
index supports the primary lookup.

### IDOR-safe lookup

A cache lookup that only consults the numeric ID is vulnerable: any
authenticated user can guess IDs and read cached content for entities they
don't own.

```typescript
// BAD: No authorization check — any user could access cached instructions
const cachedInstruction = await storage.getInstructionCache(
  cacheId,
  suggestionIndex,
);
if (cachedInstruction) {
  return res.json({ instructions: cachedInstruction.instructions });
}
```

```typescript
// GOOD: Verify ownership through parent cache
if (cacheId) {
  const parentCache = await storage.getSuggestionCacheById(cacheId);
  if (parentCache && parentCache.userId === req.userId!) {
    const cachedInstruction = await storage.getInstructionCache(
      cacheId,
      suggestionIndex,
    );
    if (cachedInstruction) {
      return res.json({ instructions: cachedInstruction.instructions });
    }
  }
}
```

Cache hits get the same ownership treatment as any other entity read.

### Invalidation via `profileHash`

Compute a stable 64-char hash over the fields of the user's profile that
affect the AI output (dietary restrictions, allergens, goal tier). Include
that hash in the cache key. When the profile changes, two layers protect
correctness:

1. **Cache misses on next lookup.** The new hash doesn't match the stored
   row, so a fresh AI call happens.
2. **Eager delete on profile update.** The profile-update endpoint
   fire-and-forget deletes the user's stale cache rows so the database
   doesn't grow unbounded with orphaned entries.

### Performance budget

- Cache hit: ~5ms (single indexed lookup).
- Cache miss: ~2000-3000ms (OpenAI round-trip).
- Hit rate after 1 week: ~85% for returning users.

## Exceptions

- **One-shot AI outputs** (e.g., a single onboarding answer) — overhead of a
  cache table isn't worth it; just compute once and store on the user record.
- **Outputs that include real-time data** (current weather, today's pantry) —
  the cache key would have to include the volatile inputs and hit rate would
  collapse.

## Related Files

- `shared/schema.ts` — cache table definitions.
- `server/storage.ts` — cache storage methods.
- `server/utils/profile-hash.ts` — `profileHash` computation utility.

## See Also

- [idor-protection-auth-ownership-check](../conventions/idor-protection-auth-ownership-check-2026-05-13.md) —
  general IDOR rule the cache lookup obeys.
- [cache-first-pattern-expensive-operations](cache-first-pattern-expensive-operations-2026-05-13.md) —
  generic cache-first pattern this design specializes for AI content.
- [batch-fetch-with-inarray-fix-n-plus-one](batch-fetch-with-inarray-fix-n-plus-one-2026-05-13.md) —
  pairs with the cached wrapper for aggregation endpoints.
