---
title: Reverse proxy silently collapsed all IP-keyed rate limiters into one global bucket
track: bug
category: logic-errors
module: server
severity: high
tags: [security, rate-limiting, deployment, railway, express, cors]
symptoms: [All IP-keyed rate limiters share one global bucket behind the proxy, Failed logins from any client lock out every user, express-rate-limit misconfig warning suppressed by a custom keyGenerator]
created: '2026-06-10'
source: 2026-06-10 security audit (S1/S2/S3)
---

# Reverse proxy silently collapsed all IP-keyed rate limiters into one global bucket

## Problem

The backend went live behind Railway's reverse proxy (2026-06-08) with no
`app.set("trust proxy", ...)`. Express therefore resolved `req.ip` to the
proxy's internal address for every request, so every IP-keyed rate limiter
(login 10/15min, register 5/hr, account-deletion 5/hr, webhooks 100/min)
shared **one global bucket across all clients**: any 10 failed logins from
anyone locked out all users for 15 minutes; more than 5 signups/hour
anywhere 429'd legitimate registrations.

## Symptoms

- None, until real traffic. The app wasn't launched, so the defect sat
  invisible in a "verified healthy" production deploy.
- **The library's own misconfig warning never fired**: express-rate-limit
  skips its `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR` validation whenever a
  custom `keyGenerator` is supplied — which this project has. A custom key
  generator buys silence, not safety.

## Root Cause

Deployment topology changed (direct → behind proxy) but no code change
accompanied it, and nothing in CI or runtime can detect the mismatch. IP
resolution is an *environmental* contract: `req.ip` is only meaningful if
`trust proxy` matches the actual hop count.

## Solution

Three layers (PR: audit/2026-06-10-security):

1. `app.set("trust proxy", 1)` in `server/index.ts` — numeric one hop.
   **Never `true`**: that trusts the leftmost (client-spoofable)
   X-Forwarded-For entry, letting attackers pick their own bucket
   (express-rate-limit `ERR_ERL_PERMISSIVE_TRUST_PROXY`).
2. `ipKeyGenerator` (`server/routes/_rate-limiters.ts`) prefers Railway's
   `X-Real-IP`, gated on the Railway-injected `RAILWAY_ENVIRONMENT_NAME`
   env var (fail-closed off Railway, where the header is client-suppliable).
   Why not rely on `trust proxy = 1` alone: Railway's hop count is NOT
   officially documented as exactly 1 (community reports of 2); Railway
   staff confirm the edge overwrites `X-Real-IP` on every request (reliable
   since Aug 2024). NOTE: the documented injected var is
   `RAILWAY_ENVIRONMENT_NAME` — `RAILWAY_ENVIRONMENT` is NOT injected
   (a doc-unverified suggestion would have shipped dead code).
3. All IP paths run through express-rate-limit v8's exported
   `ipKeyGenerator` helper (IPv6 /56 bucketing — cycling addresses within a
   delegated block otherwise bypasses the limiter; IPv4 passes through).

Gotchas hit on the way:
- `createRateLimiter` only wired its custom keyGenerator when
  `keyByUser !== false` — so the auth limiters (the ones that motivated the
  fix) were initially left on the library default. Always-wire it.
- The shared `__mocks__/express-rate-limit.ts` had to re-export the REAL
  v8 `ipKeyGenerator` via `vi.importActual` (pure helper; a hand-written
  stand-in would re-implement the logic under test).
- If Cloudflare proxying (orange cloud) is ever enabled in front of the
  API: switch keying to `CF-Connecting-IP` and re-evaluate the hop count.

## Prevention

- Any deployment-topology change (new proxy/CDN layer) must re-verify
  `trust proxy` and rate-limit keying — grep for `req.ip` consumers.
- express-rate-limit validation claims must be read from the installed
  source: its validation wrapper (`dist/index.cjs` `getValidations`)
  CATCHES ValidationError and logs — validations never throw at boot, and
  custom keyGenerators suppress several checks entirely.
- CORS allowlists are env-scoped: localhost/dev-tunnel origins must sit
  inside the `NODE_ENV !== "production"` gate; reflected ACAO needs
  `Vary: Origin` (shared-cache poisoning behind an edge/CDN).

## Related Files

- `server/index.ts` (trust proxy, CORS)
- `server/routes/_rate-limiters.ts` (ipKeyGenerator, createRateLimiter)
- `__mocks__/express-rate-limit.ts`

## See Also

- `docs/audits/2026-06-10-security.md` (full manifest incl. research citations)
- `docs/solutions/runtime-errors/vitest-mock-missing-export-masked-by-catch-2026-06-10.md`
  (same mock-missing-export class hit again here)
