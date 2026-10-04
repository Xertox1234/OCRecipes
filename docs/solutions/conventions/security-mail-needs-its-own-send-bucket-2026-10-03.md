---
title: A shared per-recipient email cap is a budget anyone who knows the address can drain — security mail (reset codes, change notices) needs its own bucket
track: knowledge
category: conventions
tags: [security, api, architecture, email, rate-limiting, password-reset, anti-enumeration]
module: server
applies_to: ["server/services/email.ts"]
created: 2026-10-03
---

# A shared per-recipient email cap is a budget anyone who knows the address can drain — security mail (reset codes, change notices) needs its own bucket

## Rule

Security mail has its own per-recipient send budget (`canSendTo(email, "account-security")`, 10/hour in `server/services/email.ts`). That covers the password-reset code, the "password changed" notice, and any future MFA or recovery mail. It must not share a budget with mail that an unauthenticated third party can trigger, such as the signup-attempt notice or verification resends. Size the security budget above the most that the route-level and DB-level caps can generate for one address.

## Why

`canSendTo` used to be **one** 5/hour sliding window per address for all outbound mail. The signup-attempt notice ("someone tried to sign up with your email") is triggered by `POST /api/auth/register`, which is limited per IP only. So anyone who knows a victim's address could send five register attempts and empty the victim's budget for an hour.

Under anti-enumeration that failure is **silent**. Forgot-password always answers "if an account uses that email, we've sent a code". A drained bucket then drops the code while the user is told it was sent, and the user can't tell "the email is slow" from "it was never sent". The same drain would suppress the "your password was changed" notice, which is exactly the mail an attacker wants suppressed.

Separate buckets make each budget independent of the other's traffic. The test pins it: exhaust the general bucket with 7 signup notices (5 send), then a reset code and a change notice to the same address still both send.

## Examples

```ts
// server/services/email.ts
type SendBucket = "general" | "account-security";
const BUCKET_CAPS: Record<SendBucket, number> = { general: 5, "account-security": 10 };
// "general" keeps the bare lowercased key (unchanged); others are prefixed.
function bucketKey(email: string, bucket: SendBucket) {
  const lower = email.toLowerCase();
  return bucket === "general" ? lower : `${bucket}:${lower}`;
}
```

Never log the payload of security mail on failure. Log the Resend error object only, because the reset code is in the HTML body.

## Exceptions

- A bucket that only an authenticated owner can trigger (e.g. a "send me my data export" mail) doesn't need separating, as long as its trigger is per-user limited.

## Related Files

- `server/services/email.ts` — `canSendTo`, `sendPasswordResetCode`, `sendPasswordChangedNotice`, `sendSignupAttemptNotice`
- `server/services/__tests__/email.test.ts` — "still sends a reset code and a notice after the general bucket is exhausted"

## See Also

- [security-caps-must-be-durable-and-say-which-window](security-caps-must-be-durable-and-say-which-window-2026-10-03.md) — the route and DB caps this budget is sized against
- [password-reset-must-cancel-stateless-identity-credentials](password-reset-must-cancel-stateless-identity-credentials-2026-10-03.md)
