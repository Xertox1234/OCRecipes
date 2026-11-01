---
title: "Put an IP-keyed limiter in front of the /api/v1 API-key check"
status: backlog
priority: low
created: 2026-10-29
updated: 2026-10-31
assignee:
labels: [deferred, security]
github_issue:
---

# Put an IP-keyed limiter in front of the /api/v1 API-key check

## Summary

Any `X-API-Key` value on `/api/v1` costs a DB lookup (and a bcrypt compare on a prefix match) before any rate limiter runs.

## Background

Audit finding L-sec-9. `server/routes/public-api.ts` (~146-147): `requireApiKey` runs before `apiRateLimiter`, which is keyed per key and monthly. A per-IP cap could throttle a legitimate partner's server, so the value is a partner/pricing decision.

Found by the 2026-10-29 pre-launch audit (manifest `docs/audits/2026-10-29-pre-launch.md`, local-only); deferred from the unattended overnight run because it needs a decision or verification that run could not make.

## Acceptance Criteria

- [x] Owner picks the per-IP rate — 60/min (2026-10-31)
- [ ] An inline `rateLimit({ keyGenerator: ipKeyGenerator, ... })` (CodeQL-traceable, like /api/health) is mounted before `requireApiKey`
- [ ] A test sends N+1 unauthenticated requests and asserts the (N+1)th is 429 without a key lookup

## Implementation Notes

See the /api/health inline limiter in `server/index.ts` for the shape and the CodeQL note.

## Scope Contract

- **Files in scope:** `server/routes/public-api.ts`, `server/routes/__tests__/public-api.test.ts`
- No new mechanisms, files, or abstractions beyond those listed.

## Updates

### 2026-10-29

- Initial creation (pre-launch audit, overnight run)

### 2026-10-31

- Owner ruling: **60 requests per minute per IP** on `/api/v1`, mounted before `requireApiKey`. No partners exist yet; raise it when one needs more.
