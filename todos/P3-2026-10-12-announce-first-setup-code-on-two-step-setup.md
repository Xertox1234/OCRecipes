---
title: "Two-step setup doesn't tell screen readers the first code was sent"
status: backlog
priority: low
created: 2026-10-12
updated: 2026-10-12
assignee:
labels: [deferred, accessibility]
github_issue:
---

# Two-step setup doesn't tell screen readers the first code was sent

## Summary

On Profile → Sign-in methods → Turn on two-step, after the password step the screen swaps to "We emailed a 6-digit code to w•••@…". Nothing announces that swap, so VoiceOver/TalkBack users get no confirmation that the first code went out. Later resends through the code field do announce.

## Background

Mobile-reviewer suggestion on the "remove authenticator apps" PR (head 30902b81). Filed rather than fixed under the one-review-pass rule.

## Acceptance Criteria

- [ ] After a successful setup send, "Code sent to <masked email>." is announced once (`AccessibilityInfo.announceForAccessibility`).
- [ ] A failed send announces nothing.
- [ ] A test covers both.

## Implementation Notes

- `client/screens/TwoStepSetupScreen.tsx`: in `onConfirmIdentity`, right after `setEmailSentTo(sent.emailHint)`.
- Tests: `client/screens/__tests__/TwoStepSetupScreen.test.tsx` (spy on `RN.AccessibilityInfo.announceForAccessibility`, as `SecondFactorField.test.tsx` does).
