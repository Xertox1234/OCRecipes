---
title: "Push tokens stay on the account when a session ends any way other than tapping Sign out"
status: done
priority: medium
created: 2026-10-20
updated: 2026-10-20
assignee:
labels: [deferred, privacy, auth, push-notifications]
github_issue:
---

# Push tokens stay on the account when a session ends any way other than tapping Sign out

## Summary

Only `logout()` in `client/hooks/useAuth.ts` calls `unregisterPushToken()`. A password reset, sign-out-everywhere, 2FA change, expired session or dead token on cold start leaves the phone's `push_tokens` row on the account, so server-driven coach reminders keep reaching a phone nobody is signed in on.

## Background

Found by the ultrareview of PR #1371 (2026-10-20, re-verified on main `1b58bba6`). Audit H2 added the sign-out DELETE, but once the session token is dead the client cannot send it. The server is the only place this can be closed.

On main, these places bump `users.token_version`:

- `server/storage/password-reset.ts` ~123
- `server/storage/mfa-email.ts` ~136
- `server/storage/mfa.ts` ~93
- `server/storage/password-change.ts` ~106
- `server/storage/users.ts` `incrementTokenVersion` ~415, called from `server/routes/auth.ts` ~865 (sign-out everywhere)

## Acceptance Criteria

- [ ] Every token-version bump deletes the user's `push_tokens` rows in the same transaction (or the same statement batch for the non-transactional bump).
- [ ] A test for each bump site asserts the user's push tokens are gone afterwards, and another user's tokens are untouched.
- [ ] The sign-out-on-this-device path is unchanged: it still sends its own DELETE.

## Implementation Notes

- Add one storage helper (for example `deletePushTokensForUser(tx, userId)`) in `server/storage/push-tokens.ts` and call it at each bump site. Sweep by target: grep `tokenVersion} + 1` and `incrementTokenVersion`, not by wording.
- After this, the 3 s sign-out cap (see `P3-2026-10-20-push-token-unregister-refetches-expo-token.md`) only matters for plain sign-out.

## Updates

### 2026-10-20

- Initial creation (ultrareview of #1371, finding 2).
- Done in PR #1530. All 5 bump sites call `deleteAllPushTokensForUser(tx, userId)` inside their transaction (`incrementTokenVersion` became a transaction). A real-DB test covers each site plus a refused-bump control. A caller that stays signed in re-registers through the client's `establishSession`. Logout now removes every device's token, because it already ended every session.
