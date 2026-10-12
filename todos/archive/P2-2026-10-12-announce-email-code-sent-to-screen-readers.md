---
title: "Screen readers aren't told when an emailed two-step code was sent"
status: done
priority: medium
created: 2026-10-12
updated: 2026-10-12
assignee:
labels: [deferred, accessibility]
github_issue:
---

# Screen readers aren't told when an emailed two-step code was sent

## Summary

Tapping "Email me a code" in the two-step code field shows "Code sent to w•••@…" and switches the button to "Resend code in Ns", but nothing announces either change. VoiceOver/TalkBack users get no confirmation that a code went out.

## Background

Mobile-reviewer WARNING on the email two-step PR (feat/two-step-email-code, head a109781a). Under the one-review-pass rule it was filed here instead of being fixed on the reviewed branch. Non-blocking: the field and the inline send error still work, and the error is announced through `InlineError`.

## Acceptance Criteria

- [x] A successful send announces "Code sent to <masked email>" once (`AccessibilityInfo.announceForAccessibility`).
- [x] A resend does not repeat the message on every countdown tick.
- [x] Nothing is announced on mount when the sign-in screen opens with the first code already sent (`alreadySent`).
- [x] A test covers the announcement after a send and no announcement on mount.

Fixed in the "remove authenticator apps" PR, which rewrote `SecondFactorField` (2026-10-12).

## Implementation Notes

- `client/components/SecondFactorField.tsx`: announce inside `sendCode` after a successful send (or an effect keyed on `sentTo` with a first-render guard).
- No live region on the node, so no `Platform.OS` gate is needed.
- Tests: `client/components/__tests__/SecondFactorField.test.tsx`.
