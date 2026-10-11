---
title: "A message anyone can trigger must not spend the same per-recipient send budget as the recovery code — otherwise an attacker starves the victim's recovery"
track: bug
category: logic-errors
tags: [security, api, architecture]
module: server
applies_to: ["server/services/email.ts", "server/routes/auth.ts"]
symptoms: ["Forgot password silently sends no code for an address someone has been re-registering", "A new notice email works in tests but its cap is shared with the password-reset code", "Repeated unauthenticated requests for one address leave its owner unable to recover the account"]
created: 2026-10-11
severity: medium
---

# A message anyone can trigger must not spend the same per-recipient send budget as the recovery code

## Problem

`server/services/email.ts` caps outbound mail per recipient in two buckets: `general` (sign-up notices, verification) and `account-security` (reset codes, 2FA notices). The auth audit's M4 fix added `sendFinishSignupNotice` — sent when someone re-registers an email that already has an unverified account — and first put it in the `account-security` bucket because the notice is about account security.

But `POST /api/auth/register` is unauthenticated and limited per IP only. Anyone can re-register `victim@x` ten times from rotating IPs, fill `victim@x`'s account-security bucket, and the victim's next Forgot-password request is throttled — silently, because the reset route answers with the same neutral 200 either way. The notice existed to point the victim at Forgot password; sharing the budget made it the thing that blocks Forgot password.

## Root Cause

A per-recipient cap is a shared resource. Its owner is whoever can make the server spend it. Bucketing by *topic* ("this email is about security") instead of by *who can trigger the send* put an attacker-triggerable message in the same pool as the one message the victim needs.

## Solution

Bucket by trigger, not topic: a message that an unauthenticated caller can cause to be sent to an arbitrary address goes in the `general` bucket, like the signup-attempt notice it resembles. The `account-security` bucket is spent only by flows the recipient (or a verified session) starts. Regression test (`server/services/__tests__/email.test.ts`): send ten finish-signup notices to one address, then assert a reset code to that address still goes out.

## Prevention

- When adding a send to a capped pool, ask who can trigger it. If an unauthenticated caller can aim it at any address, it must not share a cap with a recovery or sign-in credential.
- The same rule holds for any shared limiter: an attacker-reachable action and a recovery action in one bucket is a lockout primitive (compare the shared login bucket ruling, L2, where the owner accepted a narrower trade-off knowingly).
- A neutral response hides the starvation from the victim — test the *send*, not the HTTP status.

## Related Files

- `server/services/email.ts` — `canSendTo(email, bucket)`, `sendFinishSignupNotice`
- `server/routes/auth.ts` — register branch for an existing unverified email

## See Also

- [verified-email-is-not-password-ownership-never-auto-link-into-password-account](verified-email-is-not-password-ownership-never-auto-link-into-password-account-2026-10-11.md) — the squatter scenario M4 closes part of
- [reverse-proxy-rate-limit-keying](reverse-proxy-rate-limit-keying-2026-06-10.md) — limiter keying
