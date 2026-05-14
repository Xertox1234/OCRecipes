---
title: "Unique index + onConflictDoUpdate for AI cache dedup"
track: knowledge
category: design-patterns
tags: [database, drizzle, cache, unique-index, on-conflict, ai, race-condition]
module: server
applies_to: ["server/storage/**/*.ts", "shared/schema.ts"]
created: 2026-05-13
---

# Unique index + onConflictDoUpdate for AI cache dedup

## When this applies

When an AI cache table stores generated content keyed by `(scannedItemId, userId, profileHash)` (or similar composite key), the table **must** have a unique index on that composite key and the insert **must** use `onConflictDoUpdate`. Without this, concurrent requests that miss the cache simultaneously each insert a new row, leaving the table with duplicate entries for the same logical key.

## Examples

```typescript
// shared/schema.ts -- unique index declaration
export const suggestionCache = pgTable(
  "suggestion_cache",
  {
    id: serial("id").primaryKey(),
    scannedItemId: integer("scanned_item_id").notNull(),
    userId: text("user_id").notNull(),
    profileHash: text("profile_hash").notNull(),
    suggestions: jsonb("suggestions").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
  },
  (table) => ({
    itemUserProfileIdx: uniqueIndex(
      "suggestion_cache_item_user_profile_idx",
    ).on(table.scannedItemId, table.userId, table.profileHash),
  }),
);

// server/storage/cache.ts -- insert uses onConflictDoUpdate
await db
  .insert(suggestionCache)
  .values({ scannedItemId, userId, profileHash, suggestions, expiresAt })
  .onConflictDoUpdate({
    target: [
      suggestionCache.scannedItemId,
      suggestionCache.userId,
      suggestionCache.profileHash,
    ],
    set: { suggestions, expiresAt },
  });
```

## Why

**Contrast with `onConflictDoNothing`** (see "Defensive Cache Writes" pattern):

- **`onConflictDoUpdate`** — correct for AI-generated cache where a concurrent race should refresh the entry rather than silently drop the newer result.
- **`onConflictDoNothing`** — correct for user-seeded cache (e.g., label scan data) where the first insert wins and later inserts must not overwrite it (anti-poisoning defense).

## When to use

Any cache table whose key is a composite of system-generated identifiers (item ID + user ID + content hash) and where a concurrent duplicate should refresh the entry.

## Related Files

- `shared/schema.ts` — `suggestion_cache_item_user_profile_idx` unique index
- `server/storage/cache.ts` — `createSuggestionCache()` with `onConflictDoUpdate`

## See Also

- [Upsert with onConflictDoUpdate](upsert-with-onconflictdoupdate-2026-05-13.md)
- [Defensive cache writes with onConflictDoNothing](../conventions/defensive-cache-writes-onconflictdonothing-2026-05-13.md)
- [Cache-first pattern for expensive operations](cache-first-pattern-expensive-operations-2026-05-13.md)
