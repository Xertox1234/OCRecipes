---
title: "Make VerifyEmailScreen 'a link was sent' state explicit, not param-inferred"
status: done
priority: low
created: 2026-06-19
updated: 2026-06-19
assignee:
labels: [deferred, react-native, client-state]
github_issue:
---

# VerifyEmailScreen linkSent heuristic

## Summary

`VerifyEmailScreen` derives whether a verification email was actually sent from
`Boolean(route.params?.email)` (`client/screens/VerifyEmailScreen.tsx`). That is
a proxy, not a fact: it couples the "we've sent a link" copy to the _presence of
the email param_, not to an actual send.

## Background

From the PR #403 review. Today it is correct because the only two entry points
are: register (passes `email`, and the server did send) and login→EMAIL_NOT_VERIFIED
(passes `{}`, no send). But a future navigator that routes here with an `email`
param but no send would re-introduce the misleading "we've sent a verification
link to …" copy the review originally flagged.

## Acceptance Criteria

- [ ] "A link was sent" is driven by an explicit signal, not param inference —
      e.g. a dedicated `sent?: boolean` route param set by callers that actually
      triggered a send, or a discriminated `reason: "registered" | "login-blocked"`
      param.
- [ ] The register path passes `sent: true`; the login-blocked path passes
      `sent: false` (or omits it).
- [ ] Copy + accessibility announcements key off the explicit signal.

## Implementation Notes

- `client/screens/VerifyEmailScreen.tsx` — replace `useState(Boolean(route.params?.email))`
  with the explicit param.
- `client/screens/LoginScreen.tsx` — `navigation.navigate("VerifyEmail", { email, sent: true })`
  on verification-pending; `{ sent: false }` (or `{}`) on EMAIL_NOT_VERIFIED.
- `RootStackParamList.VerifyEmail` — add the new optional param.
- Pairs naturally with [[P3-2026-06-19-verify-email-screen-render-test]] (assert
  the copy per entry point).

## Dependencies

- Builds on the email-verification feature (PR #403).

## Risks

- Low — presentational/param-shape change; no security impact (server is the gate).
