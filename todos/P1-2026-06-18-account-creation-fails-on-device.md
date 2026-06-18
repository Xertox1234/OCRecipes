---
title: "Account creation fails in on-device iOS build against prod (api.ocrecipes.com)"
status: backlog
priority: high
created: 2026-06-18
updated: 2026-06-18
assignee:
labels: [auth, api, database]
github_issue:
---

# Account creation fails in on-device iOS build against prod (api.ocrecipes.com)

## Summary

A `preview` ad-hoc iOS build was installed on a physical iPhone (2026-06-18) and
successfully reaches the Railway backend at `https://api.ocrecipes.com`, but
**creating a new account does not work**. This blocks all authenticated testing
on the device build. Root cause not yet diagnosed — this todo is to reproduce,
find the cause, fix, and verify.

## Background

This surfaced while standing up untethered on-device testing (see auto-memory
`project_eas_build_env` → "ON-DEVICE UNTETHERED TESTING via preview profile").
The app talks to the live Railway API (not localhost), so this is the first time
the signup flow has been exercised against the **production** environment. Auth
has a documented history of repeated breakage in this project, so treat it as
high-risk and prioritize real-module evidence over assumptions.

**Not yet reproduced/diagnosed by Claude** — no root cause established. Do NOT
assume the prime suspect below is correct without confirming it against logs or
the actual error first (systematic-debugging Phase 1: gather evidence before fixing).

## Signup code path (for the focused session)

- **Client:** `client/screens/LoginScreen.tsx` — the signup branch is `mode === "ln"`
  (non-obvious naming; `"ln"` is the register action, not login). It collects
  username, password, confirmPassword, and an age-confirmation checkbox, then calls
  `ln(username.trim(), password, ageConfirmed)` from `useAuthContext()`.
- **Auth context:** `client/context/AuthContext.tsx` — the `ln` function issues the
  network request and stores the returned token.
- **API base resolution:** `client/lib/query-client.ts:22` → `getApiUrl()` reads
  build-time `EXPO_PUBLIC_DOMAIN` (baked to `https://api.ocrecipes.com` by the
  `preview` profile in `eas.json`).
- **Server route:** `server/routes/auth.ts:57` `register(app)` →
  `POST /api/auth/register` (`:59`) → `registerLimiter` (`:60`, rate limit) →
  `registerSchema.parse(req.body)` (`:63`) → `storage.createUser({...})` (`:80`).

## Ranked hypotheses (verify, don't assume)

1. **Prod DB schema not pushed** (PRIME SUSPECT). `npm run db:push` may never have
   run against the prod `DATABASE_URL`. A missing/empty `users` table makes
   `storage.createUser` throw → 500. Fastest disconfirm: connect to the prod DB and
   `\dt` / check the `users` table exists.
2. **Rate limiter / trust-proxy keying.** `registerLimiter` behind Railway's proxy —
   if `app.set("trust proxy", ...)` is misconfigured, `req.ip` collapses and the
   limiter can over-block (see `docs/rules/security.md` trust-proxy rule). Less
   likely on a first attempt, but check the response status (429 vs 500 vs 400).
3. **Validation rejection (400).** `registerSchema` may reject the input (password
   policy, username constraints, missing `ageConfirmed`). Check the exact 400 body.
4. **Client error handling masks the real error** — the screen may show a generic
   message while the server returned something specific.

## Acceptance Criteria

- [ ] Reproduced on device (or via direct API call to `api.ocrecipes.com/api/auth/register`)
      with the **actual** HTTP status + response body captured.
- [ ] Root cause identified from evidence (Railway logs and/or the network response),
      not assumed.
- [ ] Fix applied at the root cause (e.g. push schema to prod DB, fix proxy/limiter,
      correct validation — whichever it is).
- [ ] A new account can be created from the on-device build, and immediate login works.
- [ ] If the cause was prod-DB state/config (not code), document the operational fix
      so it isn't re-broken on the next environment (and consider a real-module test).

## Implementation Notes / first diagnostic steps

1. **Get the real error first.** Either: (a) attempt signup on the device while
   tailing **Railway logs** for the API service, or (b) hit the endpoint directly:
   `curl -i -X POST https://api.ocrecipes.com/api/auth/register -H 'content-type: application/json' -d '{...}'`
   to see the raw status/body. The status code alone narrows it fast: 500 → DB/server,
   429 → rate limit, 400 → validation.
2. **Check prod DB schema** (hypothesis 1): connect to the prod `DATABASE_URL` and
   confirm `users` exists. If not: `npm run db:push` against prod (NOT the local dev DB
   `postgresql://localhost/nutricam`). Note `db:push` is stateless/idempotent.
3. Only after evidence points somewhere, apply the matching fix. Auth route tests mock
   the middleware (wiring gap per `project_auth_recurring_breakage`) — prefer a
   real-module/integration check for the fix.

## Dependencies

- Access to **prod** (Railway): the API service logs and the prod `DATABASE_URL`
  (do not run schema changes against the local dev DB by mistake).
- The on-device build (already installed) OR a direct API client for reproduction.

## Risks

- **Auth is historically fragile here** — narrow the change to the confirmed root cause.
- **Touching prod DB** — if `db:push` is the fix, double-check `DATABASE_URL` points at
  prod and review the diff `db:push` proposes before applying.
- Security logic (registration, rate limiting, password handling) is in the NEVER-delegate
  set — implement directly, no cheap-worker delegation.

## Updates

### 2026-06-18

- Initial creation. Discovered during first on-device `preview` build testing against
  `api.ocrecipes.com`; app reaches the backend but account creation fails. Not yet
  reproduced/diagnosed — hypotheses ranked, prod DB schema is the prime suspect.
