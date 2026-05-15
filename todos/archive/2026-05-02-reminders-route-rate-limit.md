---
title: "Add rate limiter to /api/reminders endpoints"
status: done
priority: medium
created: 2026-05-02
updated: 2026-05-02
assignee:
labels: [deferred, audit-2026-05-02, security]
---

# Add rate limiter to /api/reminders endpoints

## Summary

All three `/api/reminders/*` endpoints use only `requireAuth` with no rate limiter. `POST acknowledge` performs a bulk UPDATE and returns `coachContext` data, making it a meaningful abuse surface.

## Background

Deferred from 2026-05-02 full audit (finding M5). `server/routes/reminders.ts` lines 20-75. The `POST /acknowledge` endpoint in particular can be called in a tight loop to hammer the DB and exfiltrate coach context data at high frequency.

## Acceptance Criteria

- [ ] All `/api/reminders/*` endpoints have a rate limiter applied (e.g. `createRateLimiter` as used in other route files)
- [ ] `POST acknowledge` is limited to ~20 req/min per user
- [ ] `GET pending` is limited to ~60 req/min per user

## Implementation Notes

Check `server/routes/` for the existing `createRateLimiter` helper pattern and apply consistently with other protected endpoints.

## Dependencies

- None

## Risks

- None — standard pattern already in use elsewhere

## Updates

### 2026-05-02

- Initial creation (deferred from audit M5)
