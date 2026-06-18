---
title: "Account creation fails in on-device iOS build against prod (api.ocrecipes.com)"
status: done
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

### 2026-06-18 — DIAGNOSED + FIXED (root cause: email-as-username, masked by generic error)

**Prime suspect (DB schema not pushed) was WRONG.** A valid payload sent directly to
prod returned `201 Created` with a real user + JWT — the `users` table, `createUser`,
defaults, and token issuance all work in prod. No `db:push` was needed.

**Evidence chain (systematic-debugging Phase 1):**

- `curl` valid payload → **201** (server-side signup healthy). Empty body → clean
  `400 VALIDATION_ERROR`. Health `200`.
- `EXPO_PUBLIC_DOMAIN=https://api.ocrecipes.com` is baked into the `preview` profile,
  and the installed build is `preview` (commit `012b56a5`) — so connectivity/localhost
  fallback is disconfirmed.
- Railway HTTP logs caught the **live device request**:
  `POST /api/auth/register → 400`, UA `OCRecipes/4 CFNetwork/...`, `responseTime: 0`
  (failed at the Zod layer, before any DB/bcrypt work). So: a validation rejection, not
  500/429/network.
- User confirmed: password was valid, but **they used an email address as the username**.
- Reproduced exactly:
  `{"error":"username: Username can only contain letters, numbers, and underscores","code":"VALIDATION_ERROR"}`.

**Root cause:** The server's `registerSchema` requires the username to match
`^[a-zA-Z0-9_]+$` (no `@`/`.`), but `LoginScreen` did **no** client-side format check and
its `catch {}` discarded the server's specific 400, showing only the generic
"Registration failed. Please try again." The user had no way to learn the rule. (Secondary:
each failed attempt counts against the 5/hour register rate limit → eventual masked 429.)

**Fix (client-only; NO server/DB change):**

- New `client/screens/LoginScreen-utils.ts`:
  - `validateAuthForm` — client-side pre-flight mirroring `registerSchema` (username
    3–30 + charset with an explicit "can't be an email" hint, password ≥8 + letter+digit,
    match, age). Catches the email case before any network call (also protects the rate limit).
  - `getAuthErrorMessage` — maps caught errors to STATIC copy via `ApiError.code`
    (adds a helpful `RATE_LIMITED` message); never renders `error.message`, honoring the
    `ocrecipes/no-error-message-in-ui` security rule (no internals/enumeration leak).
- Wired both into `LoginScreen.handleSubmit`.
- Tests: `LoginScreen-utils.test.ts` (15) + a render regression in `LoginScreen.test.tsx`
  (email username blocked, `register` never called). 18/18 pass; eslint clean (incl. the
  security rule); existing H6 static-copy tests still pass.

**Status of acceptance criteria:**

- Reproduced w/ status+body ✅ · Root cause from evidence ✅ · Fix at root cause ✅ ·
  Operational doc (cause was code/UX, not DB) ✅.
- On-device "new account can be created" — the **code** fix is test-verified but needs a
  **new build** to reach the device. Immediate unblock with the CURRENT build: use a
  non-email username (letters/numbers/underscore), which the server already accepts
  (proven by the 201).

**Open product question (NOT actioned — minimal change):** users instinctively type an
email into "Username". Consider either accepting email as the login identifier or
relabeling/explaining the field. Separate design decision.

**Housekeeping:** one stray diagnostic account `diagtest_58414261` (pw `DiagTest123`)
was created in prod during reproduction; delete if undesired.

### 2026-06-18 — RESOLVED + verified on device

- PR #399 merged to `main` (squash `225462ba`); CI green 8/8; security + code review clean.
- **On-device verification:** user created account `williamtower` on the CURRENT build →
  Railway logged `POST /api/auth/register → 201` (UA `OCRecipes/4 CFNetwork/...`,
  17:08 UTC) → app advanced to the new-user onboarding flow. AC #4 met with hard evidence.
- All acceptance criteria ✅. Follow-up captured: `P2-2026-06-18-signup-email-field.md`
  (user wants a dedicated email field — separate feature, depends on this merge).
