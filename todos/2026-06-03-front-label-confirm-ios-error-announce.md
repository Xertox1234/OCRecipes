---
title: "Add iOS-gated announceForAccessibility on FrontLabelConfirmScreen error views"
status: backlog
priority: low
created: 2026-06-03
updated: 2026-06-03
assignee:
labels: [deferred, accessibility]
github_issue:
---

# Add iOS-gated announceForAccessibility on FrontLabelConfirmScreen error views

## Summary

`FrontLabelConfirmScreen` error views use `accessibilityRole="alert"` only — TalkBack announces on Android but VoiceOver ignores `accessibilityRole="alert"` on View. iOS users get no error announcement.

## Background

Deferred from 2026-06-03 full audit (M7). File: `client/screens/FrontLabelConfirmScreen.tsx:145-150,220-229,321`. Rule: `accessibilityRole="alert"` does NOT auto-announce on iOS — an explicit iOS-gated `announceForAccessibility` is required.

## Acceptance Criteria

- [ ] Error state transitions call `AccessibilityInfo.announceForAccessibility` gated to `Platform.OS === "ios"` at lines 145-150, 220-229, 321
- [ ] Android coverage remains via existing `accessibilityRole="alert"` or `accessibilityLiveRegion="assertive"`
- [ ] VoiceOver users hear errors without needing to focus the error element

## Implementation Notes

Pattern: add `useEffect` keyed on each error state, with iOS guard. Or add the announce call directly in the mutation/handler `onError` path (fires once per failure — preferred per docs/rules/accessibility.md).

## Dependencies

- None

## Risks

- Low — additive only

## Updates

### 2026-06-03

- Initial creation (deferred from full audit M7)
