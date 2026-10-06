---
title: "ChooseUsername: tell existing users to sign in and connect Apple instead"
status: done
priority: low
created: 2026-10-06
updated: 2026-10-06
assignee:
labels: [deferred, auth, react-native]
github_issue:
---

# ChooseUsername: tell existing users to sign in and connect Apple instead

## Summary

During the device test on 2026-10-06, the owner disconnected Apple from their account, then tapped "Continue with Apple". The iPhone remembered "Hide My Email" for OCRecipes, so Apple sent a private-relay address. No account matched it, so the app offered **Choose a username** for a brand-new account. It never said the person might already have an account.

## Background

The server is correct here: it must not guess that a relay address belongs to an existing account (spec §4.3, `decideLink`). The gap is in the copy. Someone who already has an account can easily make a second one by mistake.

## Acceptance Criteria

- [x] `client/screens/ChooseUsernameScreen.tsx` shows a short hint: "Already have an OCRecipes account? Sign in with your password, then connect Apple in Settings → Sign-in methods." It includes a way back to Login. The existing "Back to sign in" button may be enough if the hint sits next to it.
- [x] The copy is static, with no server text.
- [x] A render test asserts the hint is present.

## Implementation Notes

- Screen: `client/screens/ChooseUsernameScreen.tsx`, with tests in `client/screens/__tests__/ChooseUsernameScreen.test.tsx`.
- Do not change the server linking policy. Auto-linking on a relay or unmatched email is an account-takeover risk.
- Auth-adjacent UI: never delegate to cheap workers.

## Updates

### 2026-10-06

- Done. The hint sits just above "Back to sign in", which is the way back to Login. Copy made provider-neutral for the coming Google button: "Already have an OCRecipes account? Sign in with your password instead, then add this sign-in under Settings → Sign-in methods." Test in `client/screens/__tests__/ChooseUsernameScreen.test.tsx` (failed before the change, passes after).
