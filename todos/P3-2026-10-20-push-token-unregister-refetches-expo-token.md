---
title: "Sign-out's push-token DELETE is skipped on slow networks because it re-fetches the Expo token first"
status: backlog
priority: low
created: 2026-10-20
updated: 2026-10-20
assignee:
labels: [deferred, privacy, mobile, push-notifications]
github_issue:
---

# Sign-out's push-token DELETE is skipped on slow networks because it re-fetches the Expo token first

## Summary

`unregisterPushToken` in `client/lib/push-token-registration.ts` has a 3 s cap. That budget covers both `Notifications.getExpoPushTokenAsync` (a request to Expo's push service) and our `DELETE /api/push-tokens`. On a slow network the cap fires first and the DELETE is dropped.

## Background

Found by the ultrareview of PR #1371 (2026-10-20, re-verified on main `1b58bba6`). `registerPushToken` already learns the token at sign-in but never keeps it, so sign-out asks Expo again.

## Acceptance Criteria

- [ ] When registration succeeds, the registered token is stored (in memory and/or AsyncStorage).
- [ ] Sign-out sends the DELETE with the stored token, so the only request inside the cap is ours. It falls back to `getExpoPushTokenAsync` only when nothing is stored.
- [ ] The stored token is cleared after the DELETE (or after the cap fires).
- [ ] Unit tests cover the stored path, the fallback path, and the cap still blocking a late DELETE.

## Implementation Notes

- Files: `client/lib/push-token-registration.ts` and its test.
- Keep the invariant from the existing comment: once the cap fires, the DELETE must never be sent, because `apiRequest` would attach the next user's session token.

## Updates

### 2026-10-20

- Initial creation (ultrareview of #1371, finding 4).
