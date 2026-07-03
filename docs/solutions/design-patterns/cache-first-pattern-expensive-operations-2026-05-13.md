---
title: Cache-first pattern for expensive operations
track: knowledge
category: design-patterns
module: server
tags: [database, cache, ai, openai, performance, drizzle]
applies_to: [server/routes/**/*.ts, server/storage/**/*.ts]
created: '2026-05-13'
---

# Cache-first pattern for expensive operations

## When this applies

When an endpoint performs expensive operations (OpenAI API calls, external service requests, complex computations), check for cached results first.

## Examples

```typescript
// Route handler with cache-first pattern
app.get("/api/items/:id/suggestions", requireAuth, async (req, res) => {
  const itemId = parseInt(req.params.id, 10);
  const userProfile = await storage.getUserProfile(req.userId!);
  const profileHash = calculateProfileHash(userProfile);

  // 1. Check cache first
  const cached = await storage.getSuggestionCache(
    itemId,
    req.userId!,
    profileHash,
  );
  if (cached) {
    // Increment hit count in background (fire-and-forget)
    fireAndForget("suggestion-cache-hit", storage.incrementCacheHit(cached.id));
    return res.json({ suggestions: cached.suggestions, cacheId: cached.id });
  }

  // 2. Cache miss: perform expensive operation
  const suggestions = await openai.generateSuggestions(itemId, userProfile);

  // 3. Cache result for future requests
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
  const cacheEntry = await storage.createSuggestionCache(
    itemId,
    req.userId!,
    profileHash,
    suggestions,
    expiresAt,
  );

  res.json({ suggestions, cacheId: cacheEntry.id });
});
```

Storage layer — check expiry inline:

```typescript
async getSuggestionCache(
  scannedItemId: number,
  userId: string,
  profileHash: string,
): Promise<{ id: number; suggestions: SuggestionData[] } | undefined> {
  const [cached] = await db
    .select({ id: suggestionCache.id, suggestions: suggestionCache.suggestions })
    .from(suggestionCache)
    .where(
      and(
        eq(suggestionCache.scannedItemId, scannedItemId),
        eq(suggestionCache.userId, userId),
        eq(suggestionCache.profileHash, profileHash),
        gt(suggestionCache.expiresAt, new Date()), // Check expiry inline
      ),
    );
  return cached || undefined;
}
```

## Why

- AI-generated content, external API calls, and complex computations are expensive (latency + cost) and frequently repeat for the same inputs
- TTL-based expiration checked in the query is one round-trip; an in-app expiry check would require two
- Fire-and-forget hit count tracking keeps the response fast

**Cache key must include all dimensions that vary the response.** If the response depends on user-specific context (goals, allergies, dietary profile), the cache key MUST include `userId`. A cache key that omits a varying dimension causes cross-user data leakage — User A's personalized response gets served to User B. Ask: "What makes this response unique?" and ensure every dimension is in the key.

```typescript
// BAD: question-only hash — personalized response cached globally
const hash = createHash("sha256").update(question).digest("hex");

// GOOD: userId scopes the cache per user
const hash = createHash("sha256").update(`${userId}:${question}`).digest("hex");
```

## When to use

- AI-generated content (suggestions, summaries, instructions)
- External API calls with per-request costs
- Complex computations with deterministic outputs
- Any operation taking >500ms that produces cacheable results

## Key elements

- Composite cache key (itemId + userId + contextHash)
- TTL-based expiration checked in query
- Return cacheId to enable child cache lookups
- Fire-and-forget hit count tracking

## Related Files

- `server/storage/cache.ts` — suggestion cache implementations

## See Also

- [Fire-and-forget for non-critical background operations](fire-and-forget-non-critical-background-2026-05-13.md)
- [Content hash invalidation pattern](content-hash-invalidation-pattern-2026-05-13.md)
- [Parent-child cache with cascade delete](parent-child-cache-cascade-delete-2026-05-13.md)
- [Unique index + onConflictDoUpdate for AI cache dedup](unique-index-onconflictdoupdate-ai-cache-dedup-2026-05-13.md)
- [Defensive cache writes with onConflictDoNothing](../conventions/defensive-cache-writes-onconflictdonothing-2026-05-13.md)
