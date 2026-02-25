---
title: "Add bounds and periodic sweep to token version cache"
status: pending
priority: p2
created: 2026-02-25
updated: 2026-02-25
assignee:
labels: [code-review, performance, security, auth]
---

# Add bounds and periodic sweep to token version cache

## Summary

The in-memory `tokenVersionCache` Map in `server/middleware/auth.ts` has no max size and no periodic cleanup. Expired entries only evict on read, causing slow memory growth.

## Background

Found by: security-sentinel (L1), performance-oracle (CRITICAL-1), architecture-strategist

Every authenticated user adds an entry. Entries for users who stop making requests linger indefinitely. Under credential stuffing attacks, unbounded entries could be created.

**File:** `server/middleware/auth.ts`, line 26

**Note:** The simplicity reviewer argued this entire cache should be removed (YAGNI). However, 3 other reviewers agree the cache is a sensible optimization — it just needs bounds. The 60s TTL prevents a DB hit on every authenticated request, which is valuable at scale. Decision: keep the cache, add bounds.

## Acceptance Criteria

- [ ] Max cache size (e.g., 10,000 entries) with eviction of oldest entry when full
- [ ] Periodic sweep (every 5 min) to remove expired entries
- [ ] Comment documenting single-instance constraint
- [ ] `.unref()` on the interval so it doesn't prevent process exit

## Implementation Notes

Add `MAX_CACHE_SIZE` constant and eviction in `setCachedTokenVersion`. Add `setInterval` sweep with `.unref()`.

Also document: "WARNING: This cache is process-local. In a multi-instance deployment, replace with Redis or a shared cache."

## Updates

### 2026-02-25
- Created from code review (7-agent parallel review)
