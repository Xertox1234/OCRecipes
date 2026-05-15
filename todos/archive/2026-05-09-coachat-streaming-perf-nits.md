---
title: "CoachChat streaming performance nits (limitBanner memo, onContentSizeChange, inline arrows)"
status: done
priority: low
created: 2026-05-09
updated: 2026-05-09
assignee:
labels: [deferred, performance, audit-2026-05-09]
---

# CoachChat streaming performance nits

## Summary

Three small performance issues in CoachChat that accumulate during active streaming: `limitBanner` JSX not memoized, inline arrows in `renderItem` for `BlockRenderer` (M3 partially mitigated by H2 fix), and `onContentSizeChange` already stabilized in H2 fix.

## Background

Identified in the 2026-05-09 full audit (M3, L4) by the performance-specialist agent. The H2 fix (streaming footer) resolved the main renderItem invalidation issue. These are the remaining smaller issues.

## Acceptance Criteria

- [ ] `limitBanner` JSX block wrapped in `useMemo` keyed on `isAtDailyLimit` and theme values
- [ ] `BlockRenderer` `onQuickReply`/`onCommitmentAccept` inline arrows in `renderItem` extracted to stable callbacks (note: M3 impact is reduced after H2 fix since renderItem is no longer invalidated at token rate)

## Implementation Notes

`onContentSizeChange` was already stabilized to `handleContentSizeChange useCallback([])` in the H2 fix. The `limitBanner` memoization is the clearest remaining win.
