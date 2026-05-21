---
title: "Bound + invalidate the subscription-tier and verification-streak TTL caches"
status: backlog
priority: low
created: 2026-05-20
updated: 2026-05-20
assignee:
labels: [deferred, performance]
github_issue:
---

# Bound + invalidate the subscription-tier and verification-streak TTL caches

## Summary

The two in-memory TTL caches (`subscription-tier-cache.ts`, `verification-streak-cache.ts`)
purge entries only lazily on the next same-user read, and expose no
`invalidateCache()` for mutation-time eviction. Add a bounded sweep / size cap
and an eviction hook so an IAP upgrade/downgrade or a freshly-earned streak takes
effect immediately rather than after the 60s TTL.

## Background

Found in the 2026-05-20 full audit (L2 + L3).

- **L2 (no eviction sweep / size bound):** both caches are `Map<userId, {…, expiresAt}>`
  purged only inside `getCached` when the same user reads again after expiry. A
  user who authenticates once and never returns leaves a permanent entry; the Map
  grows monotonically with distinct lifetime users. Low severity now (single
  instance, no prod deployment, process restart resets it) but worth a bound
  before scale.
- **L3 (no mutation-time invalidation):** the canonical TTL pattern
  (`server/middleware/auth.ts` `tokenVersionCache`) pairs the Map with an
  exported `invalidateCache(key)` called on logout/mutation. Neither new cache
  has one, so after an IAP confirmation or a streak crossing a threshold the user
  sees stale `PremiumFeatures`/streak-unlocks for up to the full 60s TTL.

## Acceptance Criteria

- [ ] Both caches gain a size bound or periodic sweep (or migrate to `lru-cache`)
- [ ] Both caches export an `invalidateCache(userId)` (or equivalent)
- [ ] The IAP confirmation path evicts the tier cache for the affected user
- [ ] The streak-earning path evicts the streak cache for the affected user
- [ ] Existing cache tests still pass; add a test for the new invalidation path

## Implementation Notes

Mirror the `tokenVersionCache` pattern in `server/middleware/auth.ts`. Call sites
for eviction: the IAP confirmation handler (tier) and the verification submit
path that updates the streak (streak).

## Risks

- Over-eager eviction would defeat the cache's purpose — evict only on the
  specific mutations that change the cached value.

## Updates

### 2026-05-20

- Initial creation (deferred from 2026-05-20 full audit, findings L2 + L3).
