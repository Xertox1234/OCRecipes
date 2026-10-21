---
title: "Disconnecting Apple revokes the Apple grant before the locked delete, which can still refuse"
status: done
priority: low
created: 2026-10-20
updated: 2026-10-20
assignee:
labels: [deferred, auth]
github_issue:
---

# Disconnecting Apple revokes the Apple grant before the locked delete, which can still refuse

## Summary

`DELETE /api/auth/identities/:provider` in `server/routes/auth-social.ts` (~line 860) calls `revokeAppleIdentities` before `storage.deleteIdentity` (~line 868). Since audit L16, `deleteIdentity` can refuse under its row lock when the identity is the account's last sign-in method. In that case the Apple identity is kept but its grant has already been revoked at Apple.

## Background

Found by the ultrareview of PR #1371 (2026-10-20, re-verified on main `1b58bba6`). Trigger: a passwordless account with Google and Apple linked disconnects both at about the same time. Google wins the lock, the Apple request gets 409, and the remaining Apple identity's stored refresh token is dead. Later revocation (for example on account deletion) then silently fails.

## Acceptance Criteria

- [ ] Apple revocation runs only after `deleteIdentity` returns the removed row.
- [ ] A route test: when `deleteIdentity` refuses, `revokeAppleIdentities` is not called. When it succeeds, revoke is called with the removed identity's token.
- [ ] Revocation failure after a successful delete stays non-fatal, as now.

## Implementation Notes

- Files: `server/routes/auth-social.ts` and its tests. `deleteIdentity` should return the deleted row (with `appleRefreshTokenEnc`) if it doesn't already.

## Updates

### 2026-10-20

- Initial creation (ultrareview of #1371, finding 6).
- Done in PR #1530. The route calls `deleteIdentity` first and revokes only the row it returned. A refused delete never revokes (route test).
