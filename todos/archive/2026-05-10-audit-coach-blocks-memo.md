---
title: "Coach blocks: wrap all 7 block components in React.memo"
status: completed
priority: medium
created: 2026-05-10
updated: 2026-05-15
assignee:
labels: [performance, react-native, coach, deferred]
github_issue:
---

# Coach blocks: wrap all 7 block components in React.memo

## Summary

Seven coach block components (`ActionCard`, `QuickReplies`, `RecipeCard`, `CommitmentCard`, `MealPlanCard`, `SuggestionList`, `InlineChart`) are not wrapped in `React.memo`. `renderItem` in `CoachChat` correctly uses `useCallback`, but any streaming tick that updates its deps (isStreaming, speakingMessageId) causes all persisted message blocks to re-render.

## Background

Audit 2026-05-10, finding M2. With streaming at ~20 re-renders/sec, this impacts chat smoothness on mid-range Android devices. The streaming FlatList footer pattern is already in place (StreamingBubble in ListFooterComponent); these block memoization fixes complete the picture.

## Acceptance Criteria

- [x] `ActionCard` wrapped in `React.memo`
- [x] `QuickReplies` wrapped in `React.memo`
- [x] `RecipeCard` (coach block) wrapped in `React.memo`
- [x] `CommitmentCard` wrapped in `React.memo`
- [x] `MealPlanCard` wrapped in `React.memo`
- [x] `SuggestionList` wrapped in `React.memo`
- [x] `InlineChart` wrapped in `React.memo`
- [x] No functional regressions in coach chat

## Implementation Notes

Straightforward — wrap each export with `React.memo(function ComponentName(...))`. No prop changes needed. While doing this work, also fix M8 (ActionCard accessible={false}), M9 (RecipeCard accessibilityLabel), M10 (touch targets), M11 (MealPlanCard expanded state), M12 (CommitmentCard), M13 (QuickReplies touch target) since all are in the same files.

Files in scope:

- client/components/coach/blocks/ActionCard.tsx
- client/components/coach/blocks/QuickReplies.tsx
- client/components/coach/blocks/RecipeCard.tsx
- client/components/coach/blocks/CommitmentCard.tsx
- client/components/coach/blocks/MealPlanCard.tsx
- client/components/coach/blocks/SuggestionList.tsx
- client/components/coach/blocks/InlineChart.tsx

## Updates

### 2026-05-10

- Deferred from audit 2026-05-10 (M2) — performance improvement, not blocking

### 2026-05-15

- Verified all 7 components already wrapped in `React.memo` on main: `ActionCard`, `QuickReplies`, `RecipeCard`, `CommitmentCard`, `MealPlanCard`, `SuggestionList`, `InlineChart`.
- Memoization landed via commit `53d192c4` (PR #122, "Coach blocks: wrap all 7 block components in React.memo").
- Companion accessibility fixes (M8-M13) landed via commit `9aa9b4c7` (PR #117).
- Archiving the stale todo file — no code changes needed.
