---
title: Two-tap expand-then-navigate for list items
track: knowledge
category: design-patterns
module: client
tags: [react-native, lists, accordion, animation, interaction]
applies_to: [client/screens/**/*.tsx, client/components/**/*.tsx]
created: '2026-05-13'
---

# Two-tap expand-then-navigate for list items

## When this applies

When list items have both a detail view and contextual actions (favourite, share, delete), use a two-tap interaction: first tap expands an animated action row, second tap navigates to detail. This avoids swipe gestures (which conflict with horizontal scrolling) and long-press (which has poor discoverability). The parent tracks a single `expandedItemId` (not a Set) for accordion behavior — only one item expands at a time.

## Examples

**Key insight — branch on expanded state in the child:**

```typescript
const handlePress = () => {
  if (isExpanded) {
    onNavigateToDetail(item.id); // Second tap: navigate
  } else {
    onToggleExpand(item.id); // First tap: expand actions
  }
};
```

**Key elements:**

1. **Single-selection accordion** — `expandedItemId` is a single `number | null`, toggled via `setExpandedItemId(prev => prev === itemId ? null : itemId)`
2. **Collapse on refresh** — reset `setExpandedItemId(null)` in `handleRefresh`
3. **FlatList `extraData`** — pass `expandedItemId` so FlatList re-renders when expansion state changes
4. **Animated height** — use `withTiming` on a `useSharedValue` for smooth expand/collapse

## Why

Swipe gestures conflict with horizontal scrolling in carousels and cause accidental triggers. Long-press is undiscoverable without affordances. The two-tap pattern uses the same gesture (tap) but interprets it based on state, making it discoverable (the expanded action row is visible) and conflict-free with scrolling.

## Related Files

- `client/screens/HistoryScreen.tsx` — `handleToggleExpand`, `handleNavigateToDetail`
- `client/components/HistoryItemActions.tsx` — action button row
- `client/constants/animations.ts:21` — `expandTimingConfig`, `collapseTimingConfig`

## See Also

- [Multi-section accordion with Set state](multi-section-accordion-with-set-state-2026-05-13.md)
- [Measure-then-animate collapsible height](measure-then-animate-collapsible-height-2026-05-13.md)
