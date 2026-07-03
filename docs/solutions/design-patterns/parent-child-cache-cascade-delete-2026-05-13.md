---
title: Parent-child cache with cascade delete
track: knowledge
category: design-patterns
module: shared
tags: [database, cache, foreign-keys, cascade, drizzle, schema]
applies_to: [shared/schema.ts, server/storage/**/*.ts]
created: '2026-05-13'
---

# Parent-child cache with cascade delete

## When this applies

When caching hierarchical data (parent suggestions with child instructions), use foreign key cascade delete for automatic cleanup.

## Examples

```typescript
// Schema: Parent cache
export const suggestionCache = pgTable("suggestion_cache", {
  id: serial("id").primaryKey(),
  scannedItemId: integer("scanned_item_id")
    .references(() => scannedItems.id, { onDelete: "cascade" })
    .notNull(),
  userId: varchar("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  suggestions: jsonb("suggestions").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
});

// Schema: Child cache with cascade delete from parent
export const instructionCache = pgTable("instruction_cache", {
  id: serial("id").primaryKey(),
  suggestionCacheId: integer("suggestion_cache_id")
    .references(() => suggestionCache.id, { onDelete: "cascade" }) // Auto-delete when parent deleted
    .notNull(),
  suggestionIndex: integer("suggestion_index").notNull(),
  instructions: text("instructions").notNull(),
});
```

Pass parent cacheId to enable child lookups:

```typescript
// Parent response includes cacheId
res.json({ suggestions: cached.suggestions, cacheId: cached.id });

// Client passes cacheId when requesting child data
const { data } = useQuery({
  queryKey: [`/api/items/${itemId}/suggestions/${index}/instructions`],
  queryFn: () => apiRequest("POST", url, { cacheId, ... }),
  enabled: !!cacheId,
});
```

## Why

- Single delete operation cleans up all related cache entries
- No orphaned child cache entries
- Database enforces consistency

## When to use

- Suggestions with expandable instructions
- Search results with cached detail views
- Any parent-child content relationship where child validity depends on parent

## Related Files

- `shared/schema.ts` — `suggestionCache`, `instructionCache`

## See Also

- [Cache-first pattern for expensive operations](cache-first-pattern-expensive-operations-2026-05-13.md)
