---
title: "Smooth the post-verification → login hand-off on the verify-email landing"
status: done
priority: low
created: 2026-06-22
updated: 2026-06-22
assignee:
labels: [deferred, auth, ui]
github_issue:
---

# Smooth the post-verification → login hand-off on the verify-email landing

## Summary

After a user verifies their email via the `GET /verify-email` browser landing
page, tapping "Open OCRecipes" reopens the app onto the "Check Your Inbox"
screen rather than a login prompt — a slightly confusing dead-end. Give the
verified user an obvious path to log in.

## Background

Email verification went live in prod 2026-06-22. The verify landing
(`server/lib/verify-email-page.ts`) deliberately issues NO session token
(verifying email proves address ownership, not password possession — see
`project_email_verification_plan`). Its "Open OCRecipes" button is a bare
`ocrecipes://` deep link that just foregrounds the app, which is still sitting
on the "Check Your Inbox" screen (`VerifyEmailScreen` with `sent: true`) from
signup. The app has no way to know the user just verified in the _browser_, so
it doesn't advance. The user must manually back out to log in. Functionally
correct, mildly confusing UX. Surfaced during the live end-to-end test; not a
blocker, so deferred.

## Acceptance Criteria

- [ ] After verifying, the user has an obvious one-tap path to the login screen
      (no manual back-navigation required).
- [ ] No session token is auto-issued by the verify flow (preserve the security
      property — verify ≠ login).
- [ ] Works whether the link is opened on the same device (app installed) or a
      different one (browser only).

## Implementation Notes

Two independent levers, either or both:

- **Landing-page button (server):** point "Open OCRecipes" at a login deep link
  (e.g. `ocrecipes://login`) instead of bare `ocrecipes://`, in
  `server/lib/verify-email-page.ts`. Requires a `login` path in
  `client/navigation/linking.ts` (currently the app opens to its last screen).
- **In-app screen (client):** on `VerifyEmailScreen` (the "Check Your Inbox"
  state), add a visible "I've verified — log in" affordance that routes to the
  login screen. This is the device-agnostic fix (works even if the email was
  opened on a desktop and the user returns to the app cold).
- Note: the verify landing is server-rendered HTML on `api.ocrecipes.com`; it
  cannot read app state. The hand-off is necessarily a navigation hint, not an
  auto-login.

## Dependencies

- None. The verify landing (PR #422) and the gate flip are already live.

## Risks

- Adding an `ocrecipes://login` deep link must not auto-authenticate — only
  navigate. Keep the no-token property intact.

## Updates

### 2026-06-22

- Initial creation — deferred from the email-verification gate-on session.

### 2026-06-22 (done — handled inline via /todo, auth-adjacent so not delegated)

- Implemented both levers, pure navigation (no session token issued):
  - **Server:** `server/lib/verify-email-page.ts` — added a per-state `CTA_HREF`
    map; the `success` landing button now targets `ocrecipes://login`
    (invalid/error keep the bare `ocrecipes://`). Values are static, keyed by
    server-determined state — the zero-reflected-input property is preserved.
  - **Client deep link:** `client/navigation/linking.ts` — added `Login: "login"`
    so `ocrecipes://login` routes to the sign-in screen.
  - **In-app (device-agnostic):** `client/screens/VerifyEmailScreen.tsx` — added a
    `variant="ghost"` "Back to sign in" button to the `pending` state (the
    "Check your inbox" dead-end), reusing the neutral label the `confirmed` state
    already uses so it reads correctly in both pending sub-states.
- Tests (TDD red→green): `linking.test.ts` (`Login` path), `VerifyEmailScreen.test.tsx`
  (both pending sub-states navigate to Login), new `server/lib/__tests__/verify-email-page.test.ts`
  (success→login CTA, invalid/error→bare, reflected-XSS regression guard).
- Reviewed by code-reviewer + security-auditor + accessibility-specialist — all clean
  (security-auditor: PASS, no-auto-auth + no-reflection invariants verified).
