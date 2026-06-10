---
title: "API-key cache: targeted invalidate-by-id on revoke/tier-change (avoid full flush)"
status: backlog
priority: low
created: 2026-06-09
updated: 2026-06-09
assignee:
labels: [deferred, performance, api]
github_issue:
---

# API-key cache: targeted invalidate-by-id

## Summary

On API-key revoke and tier-change, `admin-api-keys.ts` calls `clearApiKeyCache()`, which flushes the
_entire_ in-memory cache (up to `MAX_CACHED_KEYS = 10_000` entries). Correct and safe, but it forces
every other live API key to re-validate (DB lookup + bcrypt) on its next request. Add a targeted
invalidate-by-id so a single revoke/tier-change evicts only the affected key.

## Background

Surfaced by the 2026-06-09 cleanup audit (M2). The audit found the old `invalidateApiKeyCache(rawKey)`
helper was dead and removed it — but it could never have done targeted eviction here anyway, because
the revoke/tier-change paths have only the numeric key `id`, not the raw key (the cache is keyed by
`SHA-256(rawKey)`). This todo is the _correct_ way to get targeted eviction: an id-keyed lookup.

**Not a security issue** — the current full flush is strictly safe (it cannot miss the revoked key).
This is purely a perf optimization that only matters once the B2B Verified Product API has many
concurrent keys in cache and revokes/tier-changes are frequent enough that the re-validation
thundering-herd is measurable. Until then the full flush is fine.

## Acceptance Criteria

- [ ] Add `invalidateApiKeyCacheById(id: number)` to `server/middleware/api-key-auth.ts` that scans `apiKeyCache` for the entry whose `.id === id` and deletes it (O(n) over ≤10k entries — fine for a rare admin op).
- [ ] Call it from the revoke handler (`DELETE /api/admin/api-keys/:id`) and the tier-update handler (`PATCH /api/admin/api-keys/:id`) in `server/routes/admin-api-keys.ts`, replacing the two `clearApiKeyCache()` calls.
- [ ] Keep `clearApiKeyCache()` (still used by tests / available as a blunt fallback).
- [ ] Test: a revoked key is rejected on its very next request (cache evicted), AND an unrelated cached key still authenticates from cache (not flushed) — i.e. prove the eviction is targeted, not a full clear.
- [ ] `npm run check:types` clean; `api-key-auth` + `admin-api-keys` + `public-api` tests pass.

## Implementation Notes

- The cache entry already carries `id` (`{ id, tier, status, expiresAt }`), so the by-id scan needs no schema change.
- Alternative (more complex, probably not worth it): maintain a parallel `id → cacheKey` index for O(1) eviction. The O(n) scan is simpler and revokes are rare; prefer it unless profiling says otherwise.
- This is `api` + `performance` domain — never an auth-bypass change; the eviction is strictly additive safety.

## Dependencies

- None.

## Risks

- Low. The change is additive (more precise eviction). The main correctness requirement is that the by-id scan actually matches — cover it with the "unrelated key survives, revoked key evicted" test so a wrong-field scan can't silently regress to "evicts nothing."

## Updates

### 2026-06-09

- Created from cleanup audit M2 follow-up (user opted to track the perf optimization; the full flush stays for now).
