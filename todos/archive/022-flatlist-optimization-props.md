---
title: "Add FlatList optimization props to long-list screens"
status: backlog
priority: low
created: 2026-03-27
updated: 2026-03-27
assignee:
labels: [performance, client, audit-2026-03-27-full]
audit_id: L2
---

# Add FlatList optimization props to long-list screens

## Summary

Only `HistoryScreen.tsx` provides `getItemLayout`. Other FlatList-heavy screens (ChatScreen, GroceryListsScreen, SavedItemsScreen) lack `removeClippedSubviews`, `maxToRenderPerBatch`, and `windowSize`.

## Acceptance Criteria

- [ ] `removeClippedSubviews={true}` added to FlatLists that can grow beyond ~20 items (Android)
- [ ] `maxToRenderPerBatch={10}` and `windowSize={5}` added
- [ ] No visual regressions

## Implementation Notes

- Target: ChatScreen messages, GroceryListItems, SavedItemsScreen

## Dependencies

- None

## Risks

- `removeClippedSubviews` can cause rendering glitches on some Android devices — test on multiple devices

## Updates

### 2026-03-27

- Created from full audit finding L2

### 2026-04-02

- RecipeChatScreen FlatList now includes FLATLIST_DEFAULTS (audit finding M10). ChatScreen was already addressed.
