---
title: "Add rate limiters to unprotected route files"
status: pending
priority: p3
created: 2026-02-25
updated: 2026-02-25
assignee:
labels: [code-review, security, rate-limiting]
---

# Add rate limiters to unprotected route files

## Summary

8 route files have no rate limiting on any of their endpoints: goals.ts, profile.ts, healthkit.ts, weight.ts, exercises.ts, saved-items.ts, adaptive-goals.ts, and most nutrition.ts CRUD routes.

## Background

Found by: pattern-recognition-specialist (R1)

All have `requireAuth` (good), but no rate limiters. While auth prevents anonymous abuse, a compromised account could still hammer these endpoints.

## Acceptance Criteria

- [ ] Each file gets an appropriate rate limiter via `createRateLimiter`
- [ ] Suggested: 30/min for CRUD endpoints, 10/min for computation-heavy endpoints (adaptive-goals)

## Updates

### 2026-02-25
- Created from code review (7-agent parallel review)
