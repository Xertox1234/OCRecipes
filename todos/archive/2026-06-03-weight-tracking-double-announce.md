---
title: "Fix WeightTrackingScreen double accessibility announce on error"
status: done
priority: low
created: 2026-06-03
updated: 2026-06-03
assignee:
labels: [deferred, accessibility]
github_issue:
---

# Fix WeightTrackingScreen double accessibility announce on error

## Summary

`WeightTrackingScreen` mutation `onError` calls `announceForAccessibility` (not iOS-gated) AND sets error state consumed by `InlineError` (which announces independently via live region + announce). Both platforms hear the error twice, and the two strings differ ("Failed to log weight" vs "Couldn't save your weight. Please try again.").

## Background

Deferred from 2026-06-03 full audit (M6, better-fix verdict). File: `client/screens/WeightTrackingScreen.tsx:126-134,170-178`. Researcher confirmed: fix is to add `Platform.OS === "ios"` guard on the onError `announceForAccessibility` call, so Android uses InlineError's live region only. Also align the two string messages.

## Acceptance Criteria

- [ ] `announceForAccessibility` in onError is gated to `Platform.OS === "ios"`
- [ ] Both announce strings match (or onError announce is removed entirely, delegating to InlineError)
- [ ] TalkBack users hear the error exactly once
- [ ] VoiceOver users hear the error exactly once

## Implementation Notes

Two affected mutations at lines 126-134 and 170-178. Add `if (Platform.OS === "ios")` guard around each `announceForAccessibility` call. Align the string to match InlineError copy: "Couldn't save your weight. Please try again." Confirm Platform is imported.

## Dependencies

- None

## Risks

- Low — guard addition only; no logic change

## Updates

### 2026-06-03

- Initial creation (deferred from full audit M6)
