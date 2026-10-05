---
title: "Sign in with Apple — six minor follow-ups from the final whole-branch review"
status: done
priority: low
created: 2026-10-05
updated: 2026-10-05
assignee:
labels: [deferred, auth, react-native]
github_issue:
---

# Sign in with Apple — six minor follow-ups from the final whole-branch review

## Summary

Small rough edges the final review of the Sign in with Apple stack (#1260–#1268) found. None loses data or blocks anyone permanently; each gives a misleading message or a missing test.

## Background

Deferred under the one-review-pass rule: the review's Important finding (Change Email dead end) and a re-graded load-error spinner were fixed in #1268; these were graded Minor by effect.

## Acceptance Criteria

- [x] `client/screens/ConnectAccountScreen-utils.ts` `connectErrorOutcome`: password copy only for `UNAUTHORIZED` in password mode; `INVALID_PROVIDER_TOKEN` (and provider-mode `UNAUTHORIZED`) get "couldn't confirm" copy — same fix as `identityErrorMessage` in #1268.
- [x] Running out of link attempts (5 wrong passwords) no longer says "That took too long": neutral restart copy, or a distinct server code for exhaustion (`server/routes/auth-social.ts` link route, `server/storage/identities.ts` `reservePendingLinkAttempt`).
- [x] `client/screens/SignInMethodsScreen.tsx`: cancelling the Apple sheet during Connect keeps the password modal open (only clear `connecting` when `connectProvider` returns methods).
- [x] Apple sign-in onto a linked-but-unverified account routes to VerifyEmail like password login does (SocialSignInButtons hands the `EMAIL_NOT_VERIFIED` code to LoginScreen).
- [x] Test in `server/routes/__tests__/auth-social.test.ts`: a returning Apple user with no stored refresh token whose code exchange fails still signs in and `setAppleRefreshToken` is not called.
- [x] Best-effort revoke of a freshly exchanged Apple refresh token when the sign-in stops at a 403 gate (or when expired tickets carrying one are swept), so OCRecipes doesn't linger under "Apps using Apple ID".

## Implementation Notes

- Static copy keyed on `ApiError.code`, never `error.message` (`docs/rules/client-state.md`).
- Auth is high-risk: route tests use the real `requireAuth` where the existing suites do; never delegate to cheap workers.

## Updates

### 2026-10-05

- All six done on `fix/siwa-minors`. Item 2 fixed client-side: the Connect restart copy is neutral ("That sign-in can't be finished — please start again."). No new server code, because telling exhaustion apart from expiry would cost an extra query on a public endpoint.
- Item 6 ruling: no revoke at the 403 gates.
  - `auto_link` requires no second factor and a verified email, so its gate can't fail.
  - `sign_in` is an already-linked account. Revoking any Apple token can end that account's whole Apple authorization, so it is pinned by a test as never-revoke.
  - Instead, expired tickets are swept by `sweepExpiredPendingSignIns`, at most 50 per run, fire-and-forget on each new ticket. Their Apple tokens are revoked unless that Apple ID is linked or has a newer live ticket.
