---
title: "A Google/Apple link from a 2FA challenge commits even when a password reset lands mid-request"
status: done
priority: medium
created: 2026-10-20
updated: 2026-10-20
assignee:
labels: [deferred, security, auth]
github_issue:
---

# A Google/Apple link from a 2FA challenge commits even when a password reset lands mid-request

## Summary

On a `purpose: "link"` 2FA challenge, `POST /api/auth/mfa/verify` writes the identity link before the token-version check that refuses the session. A password reset or sign-out-everywhere that commits in between still lets the link through; only the session is refused.

## Background

Found by the ultrareview of PR #1371 (2026-10-20, re-verified on main `1b58bba6`). Audit L12 only made the session mint check the challenge's token version.

In `server/routes/auth-mfa.ts` (~line 174) the route compares `user.tokenVersion !== row.tokenVersion` once. It then runs `verifySecondFactor` and `consumeMfaChallenge`, and for a link challenge calls `storage.completeLinkByTicketHash` (~line 204). That function (`server/storage/identities.ts` ~line 298) deletes the ticket and inserts the `user_identities` row in its own transaction, with no token-version predicate. `issueSession(user.id, row.tokenVersion)` (~line 229) refuses afterwards, so the client sees a failure, but the attacker's identity stays linked and survives the reset.

Preconditions: the attacker has the password and the second factor, and the owner's reset commits inside the request window. The race is narrow, but the result lasts.

## Acceptance Criteria

- [ ] `completeLinkByTicketHash` takes the challenge's expected token version. Inside its transaction it locks `users` (`FOR UPDATE`) and refuses (no ticket delete, no identity insert) when `token_version` no longer matches.
- [ ] The route answers `401 MFA_CHALLENGE_EXPIRED` when the link is refused for a version mismatch.
- [ ] A real-DB storage test: bump `token_version` after creating the ticket, call `completeLinkByTicketHash` with the old version, and assert no identity row exists and the ticket is kept or deleted as designed.
- [ ] A route test covers the mismatch answer.

## Implementation Notes

- Files: `server/storage/identities.ts`, `server/routes/auth-mfa.ts`, their `__tests__/`.
- Other callers of `completeLinkByTicketHash` (grep it) must pass a version, or the new parameter stays optional only where no challenge exists. Decide per caller.

## Updates

### 2026-10-20

- Initial creation (ultrareview of #1371, finding 1).
- Done in PR #1530. `completeLinkFromTicket` / `completeLinkByTicketHash` take a required `tokenVersion`, lock `users FOR UPDATE` in the link transaction, and throw `TokenVersionChangedError` (rolled back). Both link routes answer 401 `MFA_CHALLENGE_EXPIRED`. Review of #1530 also found that `/api/auth/social/link` compared against a re-read version, not the one the password was checked under. The route now records `proofVersion` and refuses when the re-read differs.
