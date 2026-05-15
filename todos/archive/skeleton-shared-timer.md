---
title: "SkeletonBox — Share a Single Shimmer Timer"
status: in-progress
priority: low
created: 2026-04-17
updated: 2026-04-17
assignee:
labels: [performance, animation, audit-followup]
---

# SkeletonBox Shared Shimmer Timer

## Summary

`SkeletonBox` currently spawns its own `useSharedValue` + `withRepeat(withTiming(...))`
worklet per instance. `SkeletonList` renders N items × 3 boxes = 3N concurrent
shimmer animations. Share a single driver at the list level.

## Background

Audit 2026-04-17 M25. Not urgent — current counts are manageable on modern
devices — but becomes noticeable on lower-end Android when `SkeletonList` is
rendered with 10+ items at load time (chat, saved items, grocery lists).

## Acceptance Criteria

- [ ] Introduce `<SkeletonProvider>` at the top of `SkeletonList` (and any
      screen rendering ≥ 3 SkeletonBoxes) that owns a single
      `useSharedValue(0)` + `withRepeat` animation
- [ ] `SkeletonBox` reads the provider's shared value via context and
      derives its animated style (no per-instance worklet)
- [ ] Fallback to per-instance timer if `SkeletonBox` is rendered outside a
      provider (preserves current behavior for ad-hoc single-box usage)
- [ ] Verify with a 30-box stress test that animation stays 60fps on the
      simulator and on a physical device

## Implementation Notes

- The pattern mirrors how form-validation libraries use a root context
  instead of per-field subscriptions.
- Make the provider a no-op pass-through when `reducedMotion` is true —
  one context read is cheaper than N worklet skips.

## Related Audit Findings

M25 (audit 2026-04-17)

## Updates

### 2026-04-17

- Created from audit #11 deferred Medium items
