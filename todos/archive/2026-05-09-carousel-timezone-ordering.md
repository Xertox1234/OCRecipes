---
title: "Carousel time-of-day ordering: use user's local hour, not server UTC"
status: in-progress
priority: medium
created: 2026-05-09
updated: 2026-05-09
assignee:
labels: [personalization, deferred]
---

# Carousel time-of-day ordering: use user's local hour, not server UTC

## Summary

`buildCarousel` uses `new Date().getHours()` (server UTC) to pick the meal-time hint for carousel ordering. Users in non-UTC timezones get wrong meal-time boosts: a NYC user at 7pm ET (23:00 UTC) sees snack-boosted recipes instead of dinner recipes.

## Background

Introduced in Phase 2A personalization (commit `926c5a7a`). The server DB is pinned to UTC. The fix was deferred at review time because it requires a client-sent signal and is a UX improvement, not a correctness bug — the carousel still functions, it just orders by server time instead of user local time.

## Acceptance Criteria

- [ ] Client sends user's local hour (or IANA timezone name) in a request header (e.g. `X-User-Hour: 19` or `X-User-Timezone: America/New_York`)
- [ ] `GET /api/carousel` route reads the header and passes it to `buildCarousel`
- [ ] `buildCarousel` accepts an optional `userHour?: number` parameter (defaults to `new Date().getHours()` for backward compat)
- [ ] `inferMealTimeHint` is called with `userHour` instead of server hour
- [ ] Tests cover: UTC user (no header), EST user (header present, different result than UTC), invalid header value (falls back to server time)

## Implementation Notes

- Simplest approach: `X-User-Hour: 0..23` header (integer, client computes it from `new Date().getHours()`)
- Alternative: `X-User-Timezone: America/New_York` header — richer but requires server-side timezone parsing (`Intl.DateTimeFormat`)
- Header approach is cheaper; timezone name approach is more robust if the user crosses midnight between request and server processing
- Existing `buildCarousel(userId, userProfile)` signature → add optional third arg `userHour?: number`

## Dependencies

- Phase 2A (commit `926c5a7a`) must be merged first

## Risks

- Client header can be spoofed (low concern — only affects ordering, no security impact)
- Some React Native environments may not expose `getHours()` in the same way — verify on iOS and Android
