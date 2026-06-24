---
title: "Close the change-email enumeration side-channel with a staged pending-email design"
status: backlog
priority: medium
created: 2026-06-24
updated: 2026-06-24
assignee:
labels: [deferred, security, auth, api]
github_issue:
---

# Stage the new address instead of mutating `users.email` immediately

## Summary

`POST /api/auth/change-email` mutates `users.email` immediately (storing the new
address as unverified) before the new address is verified. This is what the
feature + the P3 cross-check guard required, but it has two consequences a
staged (pending-email) design would remove:

1. **Enumeration side-channel (low):** an authenticated caller can read
   `/api/auth/me` after the change to learn whether a target address was free.
2. **Typo-lockout (LIVE whenever the gate is ON):** when email verification is
   enforced (`RESEND_API_KEY` set), a fat-fingered new address immediately sets
   the account to an unverified address the user does not control. The login gate
   (`server/routes/auth.ts` ~line 267, `EMAIL_NOT_VERIFIED` 403) then locks them
   out once the current session ends, with no self-service recovery (they can
   re-change while still logged in, but not after the token expires/logout).
   **The prod gate is CONFIRMED ON** (Resend dashboard shows a delivered
   "Verify your email for OCRecipes" send on 2026-06-22) — so this is LIVE, not a
   future prerequisite. **Partially mitigated** by the confirm-email second field
   added to `ChangeEmailModal` (PR #443): a typo now has to be entered identically
   twice. That is a client-only guard and does not fix the underlying immediate
   mutation — staging is still the proper fix. A related **takeover vector** would
   activate IF a password-reset-by-email flow is ever added: a typo to a real
   inbox whose owner clicks the verification link flips the account's email to the
   typo'd (attacker-controlled) address verified (the row's email already equals
   the typo'd value, so the cross-check matches). No reset flow exists today, so
   it is latent — but list this as a hard dependency on any future password-reset
   work.

## Background

Shipped with `P2-2026-06-23-email-change-feature.md`. The endpoint returns a
neutral `verification_pending` for free / taken / same-as-current (anti-enum),
and equalizes awaited work — but because the email column changes immediately on
the free path, `/api/auth/me` afterward reveals whether the change "took":

- target free → me shows the new address → "it was available"
- target taken → me shows the old address → "it was already in use"

The probe is **self-destructive** (it overwrites the caller's OWN email with an
unverified address they don't control, locking them out at the next login on the
gate-ON path) and only meaningful when verification is enforced
(`RESEND_API_KEY` set), so severity is low. It is filed, not fixed inline, per
the deferred-todo bar.

## Acceptance Criteria

- [ ] The current `users.email` is NOT changed until the new address is verified
      (e.g. a `pending_email` column or a short-lived staging row).
- [ ] The verification link carries the pending address; on verify, the email is
      swapped to it and `email_verified` set true atomically.
- [ ] `/api/auth/me` reveals nothing about a target address's existence before
      verification completes (no free-vs-taken signal).
- [ ] The existing cross-check guard in `applyVerificationToken`
      (`markEmailVerified(sub, expectedEmail)`) is reconciled with the staged
      flow — it currently asserts the token email equals the CURRENT email, which
      a staging design changes.
- [ ] Real-module tests: pending change + verify swaps the address; an unverified
      pending change leaves `users.email` untouched; `/me` shows no oracle.

## Implementation Notes

- Endpoint: `server/routes/auth.ts` `POST /api/auth/change-email`.
- Storage: `server/storage/users.ts` — replace the immediate `updateUserEmail`
  with a stage-then-commit pair, or add `pending_email` to `shared/schema.ts`
  (column-add → migrate prod schema BEFORE merge per the Railway
  migrate-before-merge ordering note).
- The verify handler (`applyVerificationToken`) and the cross-check guard land
  together — they are coupled to whichever column holds the to-be-verified email.
- Re-confirm anti-enum parity (neutral response + equalized awaited work) still
  holds in the staged flow.

## Dependencies

- None blocking. Builds on the shipped immediate-change feature.

## Risks

- Auth/security-critical (NEVER delegate — do inline). A staged swap touches the
  verification token's meaning; mis-wiring could mark the wrong address verified.
- Adds a schema column (expand/contract migration discipline required).

## Updates

### 2026-06-24

- Filed while landing `P2-2026-06-23-email-change-feature.md`. The immediate-change
  design was deliberate (the cross-check guard depends on it); this is the
  forward hardening, surfaced by an advisor review of the shipped endpoint.
- Confirmed the prod email-verification gate is **ON** (Resend dashboard: a
  delivered verification send on 2026-06-22), so the typo-lockout is LIVE, not a
  future prerequisite. Bumped priority low → **medium** and shipped a partial
  mitigation in PR #443 (confirm-email second field in `ChangeEmailModal`). The
  staging-column redesign here is the proper fix and stays open.
