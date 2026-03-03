---
title: "Fix HistoryScreen renderItem recreation on every expand/collapse"
status: backlog
priority: medium
created: 2026-02-27
updated: 2026-02-27
assignee:
labels: [performance, client, react-native, pr-10-review]
---

# Fix HistoryScreen renderItem Recreation on Every Expand/Collapse

## Summary

The `renderItem` callback in HistoryScreen has `expandedItemId` in its 14-entry dependency array. Every tap recreates the function, forcing FlatList to re-invoke it for all 50+ visible items. This causes frame drops on expand/collapse, especially on older devices.

## Background

`client/screens/HistoryScreen.tsx` — the `renderItem` useCallback depends on:
- `expandedItemId` (changes on every tap)
- `toggleFavourite.isPending` + `toggleFavourite.variables` (changes on every mutation)
- `discardItem.isPending` + `discardItem.variables`
- 9 other dependencies

When `expandedItemId` changes, `renderItem` gets a new reference, FlatList calls it for every visible item, and each call does a shallow prop comparison via `React.memo`. With PAGE_SIZE=50, that's 50+ function invocations per tap.

Additionally, 5 inline arrow closures inside `HistoryItem` (`() => onFavourite(item.id)`, etc.) would defeat memoization if `HistoryItemActions` were ever wrapped in `React.memo`.

## Acceptance Criteria

- [ ] `expandedItemId` removed from `renderItem` dependency array
- [ ] `HistoryItem` computes `isExpanded` internally (e.g., via context or passed `expandedItemId`)
- [ ] Mutation pending state (`isPending`, `variables`) removed from `renderItem` dependencies
- [ ] Inline closures in HistoryItem resolved (parameterized callbacks or documented exception)
- [ ] Expand/collapse animation remains smooth on a list with 100+ items
- [ ] All existing tests pass

## Implementation Notes

**Option A (simplest):** Pass `expandedItemId` as a prop and have `HistoryItem` compute `isExpanded = expandedItemId === item.id` internally. Use `extraData={expandedItemId}` (already done) to trigger re-renders.

**Option B (cleanest):** Use a React Context for `expandedItemId` so `renderItem` has zero dependency on it. Each `HistoryItem` consumes the context and only re-renders when its own `isExpanded` value changes.

**For inline closures:** Either wrap `HistoryItemActions` in `React.memo` and lift closures to `useCallback`, or add a comment documenting that it's intentionally not memoized.

## Dependencies

- None

## Risks

- Changing how `isExpanded` is computed may subtly affect animation triggers
- Context approach adds complexity but eliminates the performance issue entirely

## Updates

### 2026-02-27
- Created from PR #10 code review (found by performance-oracle, pattern-recognition-specialist)
