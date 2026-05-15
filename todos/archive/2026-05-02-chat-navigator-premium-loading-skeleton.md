---
title: "Replace ChatStackNavigator null with loading skeleton"
status: in-progress
priority: medium
created: 2026-05-02
updated: 2026-05-02
assignee:
labels: [deferred, audit-2026-05-02, react-native]
---

# Replace ChatStackNavigator null with loading skeleton

## Summary

`ChatStackNavigator` returns `null` while `isPremiumLoading` is `true`, leaving the Coach tab completely blank on every app cold-start until premium queries resolve.

## Background

Deferred from 2026-05-02 full audit (finding M8). `client/navigation/ChatStackNavigator.tsx` line 26. The blank flash is noticeable on cold start and looks broken rather than loading.

## Acceptance Criteria

- [ ] While `isPremiumLoading`, the Coach tab renders a centered `ActivityIndicator` or a skeleton placeholder instead of `null`
- [ ] The loading state is visually consistent with the app's theme (uses `theme.backgroundDefault` background, `theme.textSecondary` spinner color)

## Implementation Notes

Simplest fix: replace `if (isPremiumLoading) return null;` with a full-screen centered ActivityIndicator view using `useSafeAreaInsets()` for padding.

## Dependencies

- None

## Risks

- None

## Updates

### 2026-05-02

- Initial creation (deferred from audit M8)
