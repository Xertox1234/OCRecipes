---
title: "An emailed link that acts on GET is clicked by mail scanners — and the recipient may not be the person who asked for it; act only on a POST from a confirm button"
track: bug
category: logic-errors
tags: [security, api, architecture]
module: server
applies_to: ["server/routes/auth.ts", "server/lib/verify-email-page.ts", "server/services/email.ts"]
symptoms: ["An account gets verified though its email owner never pressed anything", "A verify link verifies the moment a corporate mail filter opens it", "A squatter's sign-up becomes verified after the victim merely opens the email"]
created: 2026-10-11
severity: medium
---

# An emailed link that acts on GET is clicked by mail scanners — act only on a POST from a confirm button

## Problem

`GET /verify-email?token=…` verified the account on page load. Its comment called this safe: the token is a stateless JWT, verification is idempotent, so a mail scanner prefetching the link "merely verifies early — the intended outcome anyway".

That holds only if the person who receives the email is the person who asked for it. Anyone can register someone else's address (or press resend for it), so the link can land in a victim's inbox for a squatter's account. Then a scanner's prefetch — or a curious tap — verifies the squatter's account under the victim's email (auth audit 2026-10-10 M4).

## Root Cause

"Prefetch is harmless because it does what the user wanted" assumes the email was wanted. For any mail an unauthenticated caller can aim at an arbitrary address, the recipient's intent is unknown, so a GET that changes state acts without consent.

## Solution

- GET checks the token's signature only (no DB) and renders a confirm page whose button POSTs the token back (`renderVerifyEmailConfirmPage`). No script, no auto-submit — the click is the point.
- POST `/verify-email` does the verification (same limiter, still outside `/api` so the token never reaches access logs).
- The page now reflects the token, so the renderer accepts only the 3-segment base64url shape (≤4096) and HTML-escapes it, and the route renders it only after `jwt.verify` passes.
- The email names the account's username and says to ignore it if you didn't create this account, so the recipient can tell it isn't theirs.

## Prevention

- Before letting an emailed GET link change state, ask who can cause the email to be sent. If anyone can aim it at any address, the link renders a button and the POST acts.
- A page that must carry a token into a form: validate its charset, cap its length, escape it, and keep `Referrer-Policy: no-referrer` (helmet's default) so the query-string token doesn't leak on the button press.

## Related Files

- `server/routes/auth.ts` — GET/POST `/verify-email`
- `server/lib/verify-email-page.ts` — `renderVerifyEmailConfirmPage`
- `server/services/email.ts` — `sendVerificationEmail(to, token, username)`

## See Also

- [verified-email-is-not-password-ownership-never-auto-link-into-password-account](verified-email-is-not-password-ownership-never-auto-link-into-password-account-2026-10-11.md) — why a verified squatter account matters
- [attacker-triggered-mail-sharing-the-recovery-budget-starves-recovery](attacker-triggered-mail-sharing-the-recovery-budget-starves-recovery-2026-10-11.md) — the same "who can trigger this send?" question applied to send caps
