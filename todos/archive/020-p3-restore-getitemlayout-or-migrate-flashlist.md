---
title: "Restore getItemLayout estimate or migrate to FlashList"
status: backlog
priority: low
created: 2026-02-27
updated: 2026-02-27
assignee:
labels: [performance, client, react-native, pr-10-review]
---

# Restore getItemLayout Estimate or Migrate to FlashList

## Summary

PR #10 removed `getItemLayout` from the history FlatList because expanded items have variable height. Without it, FlatList must measure every item dynamically, degrading scroll performance by ~10-15% for long lists (100+ items).

## Background

`getItemLayout` was previously used for fixed-height items, enabling FlatList to skip measuring and jump to offsets instantly. The expandable accordion pattern requires variable heights, so it was removed. However, since only 1 item is expanded at a time, the vast majority of items are collapsed.

## Acceptance Criteria

- [ ] Scroll performance restored for long history lists
- [ ] Expand/collapse still works correctly with variable heights
- [ ] All existing tests pass

## Implementation Options

### Option A: Estimated getItemLayout (quick)

Provide `getItemLayout` using the collapsed height as the estimate. Accept minor layout jumps when an item is expanded.

### Option B: FlashList migration (better)

Replace `FlatList` with `@shopify/flash-list`:
```typescript
<FlashList estimatedItemSize={COLLAPSED_ITEM_HEIGHT} />
```

FlashList handles variable heights more efficiently than FlatList and doesn't require `getItemLayout`.

## Dependencies

- Option B requires adding `@shopify/flash-list` package

## Risks

- Option A: scroll position may jump slightly when items near the expanded one are scrolled into view
- Option B: FlashList has different API surface; may require adjustments to `renderItem`, `keyExtractor`, etc.

## Updates

### 2026-02-27
- Created from PR #10 code review (found by performance-oracle)
