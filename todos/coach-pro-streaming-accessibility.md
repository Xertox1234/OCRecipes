---
title: "Coach Pro: Add accessibility announcements for streaming state"
status: backlog
priority: medium
created: 2026-04-10
updated: 2026-04-10
assignee:
labels: [coach-pro, client, accessibility]
---

# Coach Pro: Add accessibility announcements for streaming state

## Summary

The CoachChat typing indicator and streaming content have no accessibility announcements. Screen reader users get no feedback when the coach starts or finishes responding.

## Background

Per project conventions (see MEMORY.md): `accessibilityLiveRegion` is Android-only — pair with `AccessibilityInfo.announceForAccessibility()` for iOS. This pattern is already used in CoachMicButton for listening state.

## Acceptance Criteria

- [ ] Announce "Coach is thinking..." when streaming starts (typing indicator visible)
- [ ] Announce "Coach responded" when streaming completes
- [ ] Use `AccessibilityInfo.announceForAccessibility()` on iOS
- [ ] Use `accessibilityLiveRegion="polite"` on Android for the streaming content area

## Implementation Notes

- Add announcements in CoachChat's `handleSend` (when streaming starts) and the `onDone` callback
- Follow the pattern in `CoachMicButton.tsx` which already does platform-specific announcements
