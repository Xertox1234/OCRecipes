---
title: "Fix accessibility gaps in ScanScreen confirm overlay"
status: in-progress
priority: low
created: 2026-05-02
updated: 2026-05-02
assignee:
labels: [deferred, audit-2026-05-02, accessibility]
---

# Fix accessibility gaps in ScanScreen confirm overlay

## Summary

Two accessibility issues in the confirm overlay:

1. `handleConfirmDismiss` Pressable missing `accessibilityState={{ disabled: confirmCard.isLogging }}` (L13)
2. Loading state ("Identifying food…" + spinner) not announced to VoiceOver/TalkBack — no `accessibilityLiveRegion` or `AccessibilityInfo.announceForAccessibility()` when fetch starts/completes (L14)

## Background

Deferred from 2026-05-02 full audit (findings L13 + L14). `client/screens/ScanScreen.tsx` lines 646-664 (dismiss button) and 612-620 (loading state). The "Log it" button correctly has `accessibilityState={{ busy: confirmCard.isLogging }}` — the Dismiss button is inconsistent.

## Acceptance Criteria

- [ ] Dismiss Pressable has `accessibilityState={{ disabled: confirmCard.isLogging }}` (matching disabled prop)
- [ ] When `confirmCard.isLoading` becomes true, `AccessibilityInfo.announceForAccessibility("Identifying food")` is called (iOS) and `accessibilityLiveRegion="polite"` is on the loading view (Android)
- [ ] When loading completes, the product name is announced

## Implementation Notes

For the loading announcement: add a `useEffect` on `confirmCard?.isLoading` that calls `announceForAccessibility` when it transitions to `true`. See H5 fix in this same audit for the iOS/Android pattern.

## Dependencies

- None

## Risks

- None

## Updates

### 2026-05-02

- Initial creation (deferred from audit L13 + L14)
