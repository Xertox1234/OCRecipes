---
title: "Coach Pro: Add periodic warm-up cache eviction"
status: in-progress
priority: low
created: 2026-04-10
updated: 2026-04-10
assignee:
labels: [coach-pro, server, performance]
---

# Coach Pro: Add periodic warm-up cache eviction

## Summary

The warm-up cache in `server/routes/coach-context.ts` only deletes entries on consumption or replacement. Expired entries from users who never sent the final message sit in memory indefinitely.

## Background

Each warm-up entry is small (~20 chat messages), and the cache is bounded to one entry per user, so this is a slow leak rather than an urgent issue. A periodic sweep would be cleaner.

## Acceptance Criteria

- [ ] Add `setInterval` sweep (every 60s) that deletes entries older than `WARM_UP_TTL_MS`
- [ ] Sweep runs in fire-and-forget (non-blocking)
- [ ] Server shutdown cleans up the interval

## Implementation Notes

- Simple approach: iterate `warmUpCache.entries()`, delete where `Date.now() - preparedAt > WARM_UP_TTL_MS`
- Alternative: use a TTL Map library if one is already in the project
