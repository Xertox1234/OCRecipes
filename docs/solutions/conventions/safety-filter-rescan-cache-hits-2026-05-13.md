---
title: Safety filter re-scan on response cache hits
track: knowledge
category: conventions
module: server
tags: [api, ai, cache, safety, coach]
applies_to: [server/services/**/*.ts]
created: '2026-05-13'
---

# Safety filter re-scan on response cache hits

## Rule

When a cached response is read from the cache, re-run safety checks before serving it. A response may have been cached before a safety filter was added or before safety thresholds were tightened. Skipping the re-scan means dangerous content stays live until the TTL expires.

## Why

Cache layers typically TTL on the order of hours-to-days. If a safety rule changes mid-TTL, the older entries leak unsafe content to users despite the new rule being in effect.

## Examples

```typescript
let cachedResponse = await storage.getCoachCachedResponse(questionHash);

// Re-scan after retrieving from cache — safety thresholds may have changed
// since the entry was stored (M6 — 2026-04-18)
if (cachedResponse && containsDangerousDietaryAdvice(cachedResponse)) {
  cachedResponse = null; // force fresh generation
}
```

Also bump the cache version constant whenever safety logic changes so all stale entries are cache-missed immediately:

```typescript
// Bump this string whenever safety filters change — forces cache miss for all
// existing entries rather than waiting for natural TTL expiry (H5 — 2026-04-18)
const COACH_CACHE_VERSION = "v2-2026-04-18";
```

## Related Files

- `server/services/coach-pro-chat.ts` → `hashCoachCacheKey`, `COACH_CACHE_VERSION`

## Origin

Audit finding M6 (2026-04-18).
