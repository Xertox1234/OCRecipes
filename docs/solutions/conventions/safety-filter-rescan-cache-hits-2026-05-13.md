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

For prompt changes, the coach service now invalidates the cache automatically via a memoized template hash — no manual bump needed:

```typescript
// getSystemPromptTemplateVersion() (nutrition-coach.ts) — memoized hash of the
// system-prompt template; changes automatically when the prompt prose is edited.
```

That auto-hash does **not** cover safety-regex changes: editing `SAFETY_PATTERNS` in `coach-intent-classifier.ts` doesn't touch the prompt template, so the hash stays the same and stale entries would otherwise survive the full TTL. That gap is exactly why the re-scan rule above still matters — safety filtering must run again at cache-read time regardless of what does or doesn't bust the key. A service still keyed on a manual version constant (rather than an auto-hash) must bump that constant by hand whenever its safety logic changes.

## Related Files

- `server/services/coach-pro-chat.ts` → `hashCoachCacheKey`
- `server/services/nutrition-coach.ts` → `getSystemPromptTemplateVersion`

## Origin

Audit finding M6 (2026-04-18).
