---
title: "Simplify HistoryItem animations and reduce prop count"
status: backlog
priority: low
created: 2026-02-27
updated: 2026-02-27
assignee:
labels: [simplification, client, react-native, pr-10-review]
---

# Simplify HistoryItem Animations and Reduce Prop Count

## Summary

`HistoryItem` has grown to 14 props, 4 shared animation values, and 3 animation timing configs. Several of these can be simplified: the `contentOpacity` animation is unnecessary (height clip handles it), `prevExpandedRef` is redundant, 3 timing configs can be reduced to 1-2, and the grocery/recipe stub buttons could be removed until functional.

## Specific Simplifications

### 1. Remove `contentOpacity` animation (~12 lines)

The height clip with `overflow: "hidden"` already hides content at height 0. A separate opacity animation is imperceptible. Saves one shared value and animated style.

### 2. Remove `prevExpandedRef` guard (~5 lines)

Reanimated's `withTiming` to the same target is already a no-op. The `useEffect` dependency on `isExpanded` prevents unnecessary runs. The ref guard adds complexity without benefit.

### 3. Consolidate 3 animation timing configs to 1-2

`expandTimingConfig` (300ms out-cubic), `collapseTimingConfig` (250ms in-cubic), and `contentRevealTimingConfig` (200ms out-cubic) — the 50ms differences are imperceptible. One config for expand, one for collapse (or even just one) would suffice.

### 4. Remove grocery and recipe stub buttons (optional)

`handleGroceryList` shows "coming soon" alert. `handleGenerateRecipe` navigates to MealPlanTab with no item context. Removing these drops 2 props from HistoryItem and simplifies `HistoryItemActions` from 5 actions to 3.

### 5. Reduce HistoryItem prop count

Group action callbacks into a single `onAction: (action: ActionType, item) => void` prop, or remove the 2 stub actions to get from 14 to 9 props.

## Acceptance Criteria

- [ ] `contentOpacity` shared value and animated style removed
- [ ] `prevExpandedRef` removed
- [ ] Animation timing configs consolidated
- [ ] Expand/collapse animation still looks smooth
- [ ] All existing tests pass

## Implementation Notes

Simplified animation effect:
```typescript
useEffect(() => {
  const target = isExpanded ? ACTION_ROW_HEIGHT : 0;
  const rotation = isExpanded ? 90 : 0;
  if (reducedMotion) {
    expandHeight.value = target;
    chevronRotation.value = rotation;
    return;
  }
  const config = isExpanded ? expandTimingConfig : collapseTimingConfig;
  expandHeight.value = withTiming(target, config);
  chevronRotation.value = withTiming(rotation, config);
}, [isExpanded, reducedMotion]);
```

## Dependencies

- None

## Risks

- Removing contentOpacity may make expand/collapse look slightly less polished (test on device)
- Removing stub buttons changes the UI — confirm with design

## Updates

### 2026-02-27
- Created from PR #10 code review (found by code-simplicity-reviewer)
