---
title: "Cross-check verification token email vs user email when an email-change feature lands"
status: blocked
priority: low
created: 2026-06-18
updated: 2026-06-20
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

- Dormant until an email-change feature exists. Pair this with that work.

## Risks

- None today (email is immutable). This is a forward-compat guard.

## Updates

### 2026-06-20 (blocked — dormant until an email-change feature exists)

- Set `status: blocked`. This todo's own AC is conditional ("**When** an
  email-change feature is added…") and no email-change endpoint exists, so there
  is nothing to implement now — an executor could only report "blocked." Re-open
  to `backlog` and pair with the email-change work if/when it lands.
