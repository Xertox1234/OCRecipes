---
title: "A safety check passed as an OPTIONAL argument is skipped by every new caller — mint a session only under the token version the route checked, and make that argument required"
track: bug
category: logic-errors
tags: [security, api, architecture]
module: server
applies_to: ["server/routes/auth-social.ts", "server/routes/auth-upgrade.ts", "server/routes/auth-mfa.ts", "server/services/mfa-totp.ts", "client/lib/second-factor-utils.ts", "client/hooks/useAuth.ts"]
symptoms: ["A session issued during a password reset still works after the reset", "Three audits in a row each find the same missing session-version check on a different route", "Turning on two-step in a race leaves the account with recovery codes nobody ever saw"]
created: 2026-10-11
severity: low
---

# A safety check passed as an optional argument is skipped by every new caller

## Problem

`issueSession(userId, expectedTokenVersion?)` re-reads the user row and signs a 7-day JWT with its **current** `tokenVersion`. The audit fix L12 (2026-10-10) added `expectedTokenVersion` so `/mfa/verify` refuses to mint if a reset or sign-out-everywhere bumped the version since the challenge was opened — but made it optional. The next day's upgrade-pass audit found the same gap on the two `/api/auth/upgrade/*` routes (L1), then on six older routes (L3: signed-in 2FA confirm and disable, Google/Apple sign-in, auto-link, social sign-up, link-with-password). Each was a separate finding, fixed one call site at a time.

## Symptoms

- A reset or "sign out everywhere" committing between a route's own write (or check) and `issueSession`'s read is outlived by the session minted afterwards — the new token carries the post-reset version.
- The window is milliseconds; no test caught it because route tests mock `getUser` with whatever version the happy path needs.

## Root Cause

1. **Re-reading instead of carrying.** The mint read the version again instead of using the one the route checked (the user row it loaded) or the one its own write returned (`UPDATE … SET tokenVersion = tokenVersion + 1 RETURNING`). Plain `/login` was safe only because it signs with the row it already holds.
2. **Optional guard parameter.** Every caller written before the guard, and every caller written after it, compiled without passing it. An optional safety argument is opt-in safety: the default path is the unsafe one.

## Solution

- Every mint passes the version it is entitled to: the value its own bump returned (`completePasswordUpgrade`, `confirmTotpEnrollment` via `confirmFirstEnrollment` → `{ recoveryCodes, tokenVersion }`, `confirmNewPhone`, `disableMfa`), or the `tokenVersion` of the row the route checked (social paths — no identity write bumps it).
- Once every caller passed it, the parameter became **required** and the `!== undefined` branch was deleted (4ed46817). A new mint site now fails `tsc` instead of failing an audit. Where a storage call can return `undefined` (`disableMfa` when the row is gone), answer it explicitly before minting.
- **Corollary — a refusal added after a commit must carry what the commit issued.** On the 2FA confirm paths the refusal comes after two-step is already on and the pass is spent, so the new recovery codes ride the 401 (`answer(..., { recoveryCodes })`). The server half is not enough: the client turned every non-2xx into a thrown `ApiError`, so the codes were dropped until `recoveryCodesOrThrow` (beside `replacementFromError`, same `errorBody()` parse of `${status}: ${body}`) returned them to the save-codes step (25c113ab).

## Prevention

- When a guard lands as an optional argument "so existing callers keep compiling", sweep every caller in the same PR and make it required — `grep -rn "issueSession(" server` should show no one-argument call, and the type now enforces it.
- A session is minted from the version the route **checked or wrote**, never re-read: test it by moving `getUser`'s version past the route's (`tokenVersion + 1`) and asserting 401 with no token.
- Before claiming "the client can't read an error body", grep for an existing body parser — this repo's `ApiError.message` keeps the raw body (`errorBody()` in `client/lib/second-factor-utils.ts`).

## Related Files

- `server/routes/auth-social.ts` — `issueSession(userId, expectedTokenVersion)`
- `server/routes/auth-upgrade.ts`, `server/routes/auth-mfa.ts` — mint under the written version; codes ride the refusal
- `server/services/mfa-totp.ts` — `confirmFirstEnrollment` returns `{ recoveryCodes, tokenVersion }`
- `client/lib/second-factor-utils.ts` — `recoveryCodesOrThrow`; `client/hooks/useAuth.ts` — `confirmTwoStep`, `upgradeConfirmTwoStep`

## See Also

- [auth-state-check-then-act-needs-the-predicate-in-the-write](../design-patterns/auth-state-check-then-act-needs-the-predicate-in-the-write-2026-10-11.md) — L12 and its siblings
- [spent-single-use-credential-replacement-lost-on-error-paths](spent-single-use-credential-replacement-lost-on-error-paths-2026-10-10.md) — the "ride every later response" rule the corollary extends to the client
- [request-dispatched-in-one-session-lands-in-the-next](request-dispatched-in-one-session-lands-in-the-next-2026-10-11.md) — the client-side twin (audit L2 recurred it)
