---
title: "Field-level validation on LoginScreen so the email input can set aria-invalid"
status: backlog
priority: low
created: 2026-06-19
updated: 2026-06-19
assignee:
labels: [deferred, accessibility]
github_issue:
---

# Field-level validation on LoginScreen so the email input can set aria-invalid

## Summary

`LoginScreen`'s `validateAuthForm` returns a single form-level error string
covering username/password/confirm/age/email, so the email-specific invalid state
can't be attributed to the email `TextInput` — it can't correctly set
`aria-invalid` the way `VerifyEmailScreen` now does (M9).

## Background

Finding L9 of the 2026-06-19 full audit (accessibility). This is an architectural
limitation, not a missing prop: setting `aria-invalid` on the email field requires
field-level validation that identifies WHICH field failed. Deferred for a human
design decision (it changes the form's validation/error-display shape and risks
the username-enumeration-oracle concern that keeps login lenient).

Keep the codified rule in mind: client login validation must stay LENIENT (no
enumeration oracle) — this todo is about field attribution for a11y, not adding
strict login rules.

## Acceptance Criteria

- [ ] `validateAuthForm` (or a sibling) returns per-field errors (at least
      distinguishing the email field) without making login validation strict.
- [ ] The email `TextInput` sets `error`/`errorMessage` only when the email field
      itself is invalid.
- [ ] No new enumeration oracle on login (login stays generic
      "incorrect username or password").

## Implementation Notes

- `client/screens/LoginScreen.tsx:195-210` (email input), `:292` (shared InlineError).
- `client/screens/LoginScreen-utils.ts` — `validateAuthForm`.
- Pattern reference: `VerifyEmailScreen` (M9 fix) wires `error`/`errorMessage` on a
  field-specific validation.
