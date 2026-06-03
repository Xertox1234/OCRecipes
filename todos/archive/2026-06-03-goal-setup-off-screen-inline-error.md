---
title: "Make GoalSetupScreen calculation error visible — InlineError is off-screen on error"
status: done
priority: low
created: 2026-06-03
updated: 2026-06-03
assignee:
labels: [deferred, code-quality, accessibility]
github_issue:
---

# Make GoalSetupScreen calculation error visible — InlineError is off-screen on error

## Summary

`GoalSetupScreen` `calculateMutation.onError` fires haptic only — the corresponding `InlineError` is off-screen below the calculate button. Users get no visible or audible feedback without manually scrolling down.

## Background

Deferred from 2026-06-03 full audit (M14). File: `client/screens/GoalSetupScreen.tsx:270-272,480-487`.

## Acceptance Criteria

- [ ] On `calculateMutation` error, the scroll position moves to show the InlineError (scroll to the error element)
- [ ] OR: add `AccessibilityInfo.announceForAccessibility` (iOS-gated) in the `onError` handler so VoiceOver announces without scrolling
- [ ] Error is visible/audible without manual interaction

## Implementation Notes

Option 1: `scrollViewRef.current?.scrollTo({ y: errorOffset, animated: true })` in `onError`. Option 2: add iOS-gated announce in `onError` as a parallel signal. Option 2 is simpler and handles the accessibility case; option 1 is needed for sighted users too. Prefer combining both.

## Dependencies

- None

## Risks

- Scroll ref availability; ensure `ScrollView` has a ref

## Updates

### 2026-06-03

- Initial creation (deferred from full audit M14)
