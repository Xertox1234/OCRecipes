---
title: "Password reset follow-ups from the PR #1233 review: fixed-window wording, client copy, and field-level errors"
status: backlog
priority: low
created: 2026-10-03
updated: 2026-10-03
assignee:
labels: [deferred, security, react-native]
github_issue:
---

# Password reset follow-ups from the PR #1233 review: fixed-window wording, client copy, and field-level errors

## Summary

PR #1233 (password reset by emailed code) passed its one review pass with no blocking findings. Its non-blocking findings were not fixed on the reviewed branch, per the one-review-pass rule. They are collected here.

## Background

Every item below was checked against the tree at the reviewed head before it was filed.

1. **The issuance cap is a fixed window, not a rolling one** (server-reviewer, measured). `issuePasswordResetCode`'s `CASE WHEN windowExpired THEN 1 / now()` resets the count 24 h after the window's first code. So a burst that straddles the boundary can issue up to 11 codes in a short span: 1 + 5 just before the reset and 6 just after. The long-run average stays at ≤6 per 24 h, so the "about 1% per year" bound holds. But four places say "rolling 24 h", which is false: the docblock in `server/storage/password-reset.ts`, `shared/constants/password-reset.ts`, the archived P1 todo, and spec §4.1/§4.6. The spec's "30 guesses/day" figure is also wrong for a 24 h span that crosses a boundary. In such a span the worst case is 11 codes × 5 guesses = 55.
2. **The archived P1 todo claims more than was built** (code-reviewer, server-reviewer). Its "Recovering the username" box is ticked. That item also asks for `loginAccountLimiter` to share one bucket per account and for usernames to be lowercased, and neither was built. Both were deliberate choices (spec §4.3: two buckets per account, so 20 failed tries per 15 min; usernames still match exactly), but the 2026-10-03 Updates entry doesn't say so.
3. **ForgotPassword says "try again shortly" for an email the server will never accept** (code-reviewer, probe). The client's email regex accepts addresses that Zod `.email()` rejects, such as `user@domain.c`, `a..b@x.com`, `user@-x.com` and `user@x_y.com`. The server's 400 `VALIDATION_ERROR` then falls through to "Couldn't send a code right now. Please try again shortly.", so the user retries forever.
4. **The 429 message gives the wrong reason and the wrong wait when the per-IP limiter fires** (mobile-reviewer). `getResetRequestErrorMessage` maps every 429 to "Too many code requests for this email. Try again in an hour." `forgotPasswordIpLimiter` (10 per 15 min) sends the same `RATE_LIMITED` body as the per-email limiter, so the client can't tell them apart.
5. **ResetPassword never marks the failing field** (mobile-reviewer). A bad code, a weak password, a mismatch, or a server `INVALID_RESET_CODE` shows only in `InlineError`. No input gets `error`/`errorMessage`, so none gets `aria-invalid`. ForgotPassword already does this correctly.
6. **The Resend announcement says more than the server does** (mobile-reviewer). "A new code has been sent." is false for an unknown email or for an account that has hit the daily cap. The rest of the flow says "If an account uses…".

## Acceptance Criteria

- [ ] Item 1 (**owner decided 2026-10-03: fix the wording, keep the fixed window**): change the "rolling 24 h" claims in `server/storage/password-reset.ts` and `shared/constants/password-reset.ts`, and the archived P1 todo's 2026-10-03 entry, to "a fixed 24 h window from the first code; up to 11 codes in a span that crosses the window boundary". No schema change. The spec is local-only and gets corrected by hand.
- [ ] Item 2: the archived P1 todo's Updates entry records both deliberate deviations (two login buckets per account; usernames still case-sensitive).
- [ ] Item 3: `getResetRequestErrorMessage` maps `VALIDATION_ERROR` to "Please enter a valid email address.", with a test.
- [ ] Item 4 (**owner decided 2026-10-03: one neutral message**): `getResetRequestErrorMessage` maps every 429 to "Too many code requests. Please wait a while and try again." (no "this email", no "an hour"). Spec §2's copy follows. Tested. No server change.
- [ ] Item 5: `validateResetForm` reports which field failed, and that input gets `error`/`errorMessage`. The code input is also marked on `INVALID_RESET_CODE`. Render test asserts it.
- [ ] Item 6: the Resend announcement is hedged like the rest of the flow.

## Implementation Notes

- Item 1 touches only comments, plus the local-only spec by hand. The fixed-window behavior and its rationale are recorded in `docs/solutions/conventions/security-caps-must-be-durable-and-say-which-window-2026-10-03.md`.
- Items 3–6 are client-only: `client/screens/ForgotPasswordScreen-utils.ts`, `client/screens/ResetPasswordScreen-utils.ts`, `client/screens/ResetPasswordScreen.tsx`, and their tests.
- Don't use `try/finally` in the screens: React Compiler can't lower it, and `scripts/check-react-compiler-bailouts.js` fails CI.

## Scope Contract

- **Mechanisms to use:** the existing screens, utils, `TextInput` `error`/`errorMessage` props, and the existing limiters. No new mechanisms: both open decisions were settled toward the no-new-mechanism option.
- **Files in scope:** `server/storage/password-reset.ts` (comment only), `shared/constants/password-reset.ts` (comment only), `todos/archive/P1-2026-09-26-no-password-reset-or-account-recovery.md`, `client/screens/ForgotPasswordScreen-utils.ts`, `client/screens/ResetPasswordScreen-utils.ts`, `client/screens/ResetPasswordScreen.tsx`, and the matching `__tests__` files.
- No other new mechanisms, files, or abstractions.

## Dependencies

- PR #1233 merged.

## Updates

### 2026-10-03

- PR #1233 merged (`d4b440c9`). The owner settled both open choices: item 1 → fix the wording (keep the fixed window), item 4 → one neutral 429 message. With no open decisions left, this todo is executable as written and needs no `human_led` gate (the confirmation reviewer's concern is resolved).
