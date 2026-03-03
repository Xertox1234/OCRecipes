---
title: "Bound in-memory photo analysis session store"
status: done
priority: critical
created: 2026-02-27
updated: 2026-02-27
assignee:
labels: [security, performance, server, memory]
---

# Bound In-Memory Photo Analysis Session Store

## Summary

The `analysisSessionStore` in `server/routes/photos.ts` is an unbounded `Map` holding full base64 images (~1-4 MB each). A misbehaving or malicious client could create unlimited sessions, exhausting server memory. Need per-user caps, a global cap, and ideally move to Redis.

## Background

At `server/routes/photos.ts` lines 31-37, every photo analysis request creates a session storing the full base64 image in a `Map`. The 30-minute timeout cleanup exists, but there are no limits on:
- Concurrent sessions per user
- Total sessions globally
- Total memory consumed

A single user sending 100 analysis requests would consume ~100-400 MB of server memory. The existing `TODO` comment (line 31) acknowledges this needs Redis for production.

## Acceptance Criteria

- [x] Max sessions per user enforced (e.g., 3 concurrent)
- [x] Global session cap enforced (e.g., 1000 total)
- [x] Oldest session evicted when caps are hit (LRU-style) or new request rejected with 429
- [x] Session size validated before storing (reject images > 5 MB decoded)
- [x] Memory usage does not grow unboundedly under load
- [x] All existing photo analysis tests pass

## Implementation Notes

### Quick Fix (in-memory caps)

```typescript
const MAX_SESSIONS_PER_USER = 3;
const MAX_SESSIONS_GLOBAL = 1000;
const MAX_SESSION_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

// Track per-user session count
const userSessionCount = new Map<number, number>();
```

Before creating a new session:
1. Check `analysisSessionStore.size < MAX_SESSIONS_GLOBAL`
2. Check `userSessionCount.get(userId) < MAX_SESSIONS_PER_USER`
3. Check decoded image size < `MAX_SESSION_SIZE_BYTES`
4. If any check fails, return 429 with clear error message

### Production Fix (Redis)

Move session data to Redis with TTL keys:
- Key: `photo:session:{sessionId}`
- Value: base64 image string
- TTL: 30 minutes (automatic cleanup)
- Use `SCARD` on `photo:user:{userId}:sessions` set for per-user cap

## Dependencies

- None for the quick fix
- Redis infrastructure for the production fix

## Risks

- Per-user cap could frustrate legitimate power users (pick a reasonable limit)
- Need to clean up `userSessionCount` when sessions expire

## Updates

### 2026-02-27
- Initial creation from codebase audit
- Implemented: per-user cap (3), global cap (1000), image size validation (5 MB), per-user count tracking with cleanup on session expiry/confirm. New request rejected with 429/413. Added 4 tests covering all bounds. All 2364 tests pass.
