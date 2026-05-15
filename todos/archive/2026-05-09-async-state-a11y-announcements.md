---
title: "Add screen reader announcements for async state transitions (CoachChat, WeightLog, Fasting)"
status: done
priority: high
created: 2026-05-09
updated: 2026-05-09
assignee:
labels: [deferred, accessibility, audit-2026-05-09]
---

# Add screen reader announcements for async state transitions

## Summary

Three components show async state changes (daily limit hit, weight log success, fasting start/end) without any VoiceOver/TalkBack announcement — screen reader users have no feedback.

## Background

Identified in the 2026-05-09 full audit (H12) by the accessibility-specialist agent. All three require both `accessibilityLiveRegion` (Android) and `AccessibilityInfo.announceForAccessibility` (iOS) per `docs/patterns/react-native.md`.

## Acceptance Criteria

- [ ] `CoachChat.tsx:568–578` — limit banner: add `accessibilityLiveRegion="assertive"` and `announceForAccessibility` when `isAtDailyLimit` becomes true
- [ ] `WeightLogDrawer.tsx:118–148` — log success: announce "Weight logged" via `AccessibilityInfo.announceForAccessibility` in the `onSuccess` handler
- [ ] `FastingDrawer.tsx` — fasting start/end: announce success/error for both start and end actions
- [ ] All announcements use `"assertive"` polarity for blocking state changes

## Implementation Notes

Pattern is established in `QuickLogDrawer.tsx` (parseError/submitError iOS announcements added in 2026-05-02 audit H5 fix). Follow the same `useEffect` + `AccessibilityInfo.announceForAccessibility` pattern.
