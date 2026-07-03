---
title: Admin operations must invalidate in-memory caches
track: knowledge
category: conventions
module: server
tags: [database, cache, admin, security, api-keys, invalidation]
applies_to: [server/routes/admin-*.ts, server/middleware/**/*.ts]
created: '2026-05-13'
last_updated: '2026-06-10'
---

# Admin operations must invalidate in-memory caches

## Rule

When an admin endpoint modifies state that is cached in memory (API key revocation, tier changes, feature flags), it must explicitly invalidate the relevant cache. In-memory caches have no automatic link to the database — a revoked API key remains valid until the cache entry expires or is cleared.

## Examples

```typescript
// ❌ BAD: Revoke in DB but cache still holds the old valid entry
app.post("/api/admin/api-keys/:id/revoke", requireAdmin, async (req, res) => {
  await storage.revokeApiKey(req.params.id);
  res.json({ success: true });
  // Revoked key still authenticates for up to TTL duration
});

// ✅ GOOD: Invalidate cache after state change
import { invalidateApiKeyCacheById } from "../middleware/api-key-auth";

app.post("/api/admin/api-keys/:id/revoke", requireAdmin, async (req, res) => {
  await storage.revokeApiKey(req.params.id);
  invalidateApiKeyCacheById(id); // Evict only the affected key — other live keys stay cached
  res.json({ success: true });
});
```

## Why

In-memory caches (TTL Maps, LRU caches) are performance optimizations that trade consistency for speed. Admin operations are rare but security-critical — a revoked API key or downgraded subscription must take effect immediately, not after a 5-minute TTL.

Prefer targeted eviction over a full flush when cache entries carry an identifier — a full `clearApiKeyCache()` forces every other live key to re-validate (DB + bcrypt thundering herd). The `apiKeyCache` is keyed by SHA-256(rawKey) and the revoke/tier-change handlers only have the numeric id, so eviction must scan entries by entry.id (O(n) over <=10k entries, fine for rare admin ops). `clearApiKeyCache()` remains as a blunt fallback and test reset. Eviction is per-process; multi-instance deployments need a shared signal (60s TTL bounds staleness meanwhile).

## When to use

Any admin or system operation that modifies data backing an in-memory cache — API key CRUD, subscription tier changes, feature flag toggles, rate limit config updates.

**Audit ref:** 2026-04-02-full M2

## Related Files

- `server/routes/admin-api-keys.ts` — `invalidateApiKeyCacheById(id)` after revoke and tier update
- `server/middleware/api-key-auth.ts` — `apiKeyCache` Map with `invalidateApiKeyCacheById()` and `clearApiKeyCache()` exports

## See Also

- [Content hash invalidation pattern](../design-patterns/content-hash-invalidation-pattern-2026-05-13.md)
- [Admin auth via isAdmin() allowlist](admin-auth-isadmin-allowlist-2026-05-13.md)
