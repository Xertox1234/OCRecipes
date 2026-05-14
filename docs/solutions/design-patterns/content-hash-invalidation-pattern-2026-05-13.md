---
title: "Content hash invalidation pattern"
track: knowledge
category: design-patterns
tags: [database, cache, invalidation, hashing, personalization]
module: server
applies_to:
  ["server/storage/**/*.ts", "server/utils/**/*.ts", "server/routes/**/*.ts"]
created: 2026-05-13
---

# Content hash invalidation pattern

## When this applies

When cached content depends on user preferences that can change, use a content hash to detect when cache should be invalidated.

## Examples

```typescript
// server/utils/profile-hash.ts
import crypto from "crypto";
import type { UserProfile } from "@shared/schema";

/**
 * Calculate hash of profile fields that affect cached content.
 * Cache is invalidated when hash changes.
 */
export function calculateProfileHash(profile: UserProfile | undefined): string {
  const hashInput = JSON.stringify({
    allergies: profile?.allergies ?? [],
    dietType: profile?.dietType ?? null,
    cookingSkillLevel: profile?.cookingSkillLevel ?? null,
    cookingTimeAvailable: profile?.cookingTimeAvailable ?? null,
  });
  return crypto.createHash("sha256").update(hashInput).digest("hex");
}
```

Store hash with cache entry:

```typescript
export const suggestionCache = pgTable("suggestion_cache", {
  id: serial("id").primaryKey(),
  scannedItemId: integer("scanned_item_id")
    .references(() => scannedItems.id)
    .notNull(),
  userId: varchar("user_id")
    .references(() => users.id)
    .notNull(),
  profileHash: varchar("profile_hash", { length: 64 }).notNull(), // Store hash
  suggestions: jsonb("suggestions").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
});
```

Cache lookup includes hash in WHERE clause:

```typescript
// Cache hit only if profileHash matches current profile state
const cached = await storage.getSuggestionCache(itemId, userId, profileHash);
```

Eager invalidation on profile update:

```typescript
app.patch("/api/profile", requireAuth, async (req, res) => {
  const fieldsAffectingCache = [
    "allergies",
    "dietType",
    "cookingSkillLevel",
    "cookingTimeAvailable",
  ];
  const changedCacheFields = fieldsAffectingCache.some(
    (field) => field in req.body,
  );

  const profile = await storage.updateUserProfile(req.userId!, req.body);

  // Eagerly invalidate cache if relevant fields changed
  if (changedCacheFields) {
    fireAndForget(
      "suggestion-cache-invalidation",
      storage.invalidateCacheForUser(req.userId!),
    );
  }

  res.json(profile);
});
```

## Why

Hash provides content-based invalidation. A user could update their profile (changing timestamp) without changing relevant fields, so timestamp-based invalidation would over-invalidate.

## When to use

- AI-generated content personalized to user preferences
- Computed results that depend on user settings
- Any cache where content correctness depends on user profile state

## Related Files

- `server/utils/profile-hash.ts` — `calculateProfileHash()`

## See Also

- [Cache-first pattern for expensive operations](cache-first-pattern-expensive-operations-2026-05-13.md)
- [Admin operations must invalidate in-memory caches](../conventions/admin-operations-invalidate-in-memory-caches-2026-05-13.md)
