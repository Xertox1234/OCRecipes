---
title: "Behind a shared IP, the social-config rate limit hides the Google/Apple buttons"
status: backlog
priority: low
created: 2026-10-20
updated: 2026-10-20
assignee:
labels: [deferred, auth, rate-limiting]
github_issue:
---

# Behind a shared IP, the social-config rate limit hides the Google/Apple buttons

## Summary

`GET /api/auth/social/config` (`server/routes/auth-social.ts` ~line 283) uses `crudRateLimit`. The route is public, so the limiter keys on IP: 30 requests a minute shared with other unauthenticated `crudRateLimit` routes. Behind carrier CGNAT or campus Wi-Fi the bucket fills, the client's `useSocialConfig` turns the 429 into `{ google: false, apple: false }`, and the sign-in buttons quietly disappear.

## Background

Found by the ultrareview of PR #1371 (2026-10-20, re-verified on main `1b58bba6`). Audit L18 added the limit. The route returns two booleans from env config, so it is cheap to serve.

## Acceptance Criteria

- [ ] The route has its own limiter with a much higher per-IP ceiling, not the shared `crudRateLimit` bucket. It keeps an inline traceable limiter so CodeQL's `js/missing-rate-limiting` stays satisfied.
- [ ] The client keeps its last known config (or a long `staleTime`) on an error, so a 429 doesn't hide buttons that were showing.
- [ ] Tests: the server limiter is distinct and allows well over 30/min. The client hook returns the cached config after an error.

## Implementation Notes

- Files: `server/routes/auth-social.ts`, `server/routes/_rate-limiters.ts`, `client/hooks/useSocialConfig.ts`, their tests.

## Updates

### 2026-10-20

- Initial creation (ultrareview of #1371, finding 8).
