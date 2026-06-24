---
title: "Cross-check verification token email vs user email when an email-change feature lands"
status: done
priority: low
created: 2026-06-18
updated: 2026-06-24
assignee:
labels: [deferred, security, api]
github_issue:
---

# Cross-check verify-email token `email` against the user's current email

## Summary

`POST /api/auth/verify-email` marks `payload.sub` verified via
`storage.markEmailVerified(payload.sub)` and ignores the token's `email` claim.
This is safe **today** but becomes a footgun the moment an email-change feature
exists.

## Background

The verification token carries both `sub` and `email`
(`server/lib/verification-token.ts`), but the verify endpoint only uses `sub`.
Email is currently immutable (no email-change endpoint), so `sub` and `email`
can never diverge and there is no exploit. Surfaced by the security-auditor
review of the email-verification branch ([[project_email_verification_plan]]).

The latent risk: once a user can change their email, an **old** verification
link (issued for their previous address) would still flip
`email_verified = true` for the account — marking a _new, unverified_ address as
verified. `markEmailVerified` doesn't change which email is stored, but it would
wrongly clear the unverified state of whatever address is current.

## Acceptance Criteria

- [ ] When an email-change feature is added, `verify-email` validates that the
      token's `email` claim matches the user's current `users.email` before
      flipping `email_verified` (reject with the same neutral 400 on mismatch).
- [ ] A test covers the stale-token-after-email-change case.

## Implementation Notes

- `server/routes/auth.ts` `/api/auth/verify-email` handler; `payload.email` is
  already available from `verifyVerificationToken`.
- Option A: fetch the user, compare `user.email === payload.email`, then mark.
  Option B: have `markEmailVerified(id, expectedEmail)` add the equality to its
  `WHERE` clause so it's a single atomic statement.
- Changing an email should also invalidate outstanding verification links for
  the old address (or rely on this cross-check to neutralize them).

## Dependencies

- Dormant until an email-change feature exists. Pair this with that work:
  `P2-2026-06-23-email-change-feature.md` (the feature todo that unblocks this —
  its AC includes landing this cross-check guard).

## Risks

- None today (email is immutable). This is a forward-compat guard.

## Updates

### 2026-06-20 (blocked — dormant until an email-change feature exists)

- Set `status: blocked`. This todo's own AC is conditional ("**When** an
  email-change feature is added…") and no email-change endpoint exists, so there
  is nothing to implement now — an executor could only report "blocked." Re-open
  to `backlog` and pair with the email-change work if/when it lands.

### 2026-06-22 (re-verified blocked via `/todo`)

- Re-checked the blocking condition: a sweep of `server/routes/`,
  `server/services/`, and `client/` found **no** email-change feature
  (`newEmail`/`changeEmail`/`updateEmail`/PATCH-PUT email), and
  `applyVerificationToken` (`server/routes/auth.ts:94`) still marks via
  `markEmailVerified(payload.sub)`, ignoring `payload.email`. Block holds —
  staying deferred per user decision.
- Implementation caveat for whoever picks this up: the schema has a
  `lower(email)` unique index, so the cross-check must compare
  **normalization-aware** (case-insensitive), not a bare
  `user.email === payload.email`, or it will reject legitimate current tokens.

### 2026-06-23 (filed the unblocking feature todo)

- Re-confirmed block holds: grep for `newEmail`/`changeEmail`/`updateEmail`/etc.
  across `server/`, `client/`, `shared/` returns zero; `applyVerificationToken`
  (`server/routes/auth.ts:94`) still marks via `markEmailVerified(payload.sub)`,
  ignoring `payload.email`.
- Created `P2-2026-06-23-email-change-feature.md` to track the missing feature;
  its AC carries this cross-check guard so the two land together. Stays `blocked`.

### 2026-06-24 (DONE — landed with the email-change feature)

- Implemented Option B (atomic): `markEmailVerified(id, expectedEmail)` now folds
  `lower(email) = lower(expectedEmail)` into its WHERE clause
  (`server/storage/users.ts`), and `applyVerificationToken`
  (`server/routes/auth.ts`) passes `payload.email`. A stale verification link for
  a previous address updates zero rows → `undefined` → neutral 400, so it can no
  longer flip a newly-changed unverified address verified. Real-module test
  (`server/storage/__tests__/users.test.ts`) covers the stale-token-after-change
  case; route tests assert the 2-arg call. Shipped on branch
  `feat/account-email-change` alongside `P2-2026-06-23-email-change-feature.md`.
