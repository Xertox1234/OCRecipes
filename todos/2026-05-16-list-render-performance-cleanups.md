---
title: "Clean up list render performance drift"
status: backlog
priority: medium
created: 2026-05-16
updated: 2026-05-16
assignee:
labels: [deferred, performance, hooks, react-native]
github_issue:
---

# Clean Up List Render Performance Drift

## Summary

Audit findings M3 and L3 found smaller list performance drift: callback deps include whole mutation objects, and user-growth picker lists omit shared FlatList defaults.

## Background

The broad sweep found whole TanStack mutation objects in callback dependency arrays feeding `FlatList` render paths. It also found grocery-list and cookbook picker modals rendering user-created collections without `FLATLIST_DEFAULTS`.

## Acceptance Criteria

- [ ] Destructure stable mutation members used by list callbacks in `ChatListScreen`.
- [ ] Destructure stable mutation members used by list callbacks in `GroceryListsScreen`.
- [ ] Add `FLATLIST_DEFAULTS` to `GroceryListPickerModal` and `CookbookPickerModal` where appropriate.
- [ ] Run targeted typecheck or focused tests for touched files.

## Implementation Notes

Relevant files:

- `client/screens/ChatListScreen.tsx`
- `client/screens/meal-plan/GroceryListsScreen.tsx`
- `client/components/GroceryListPickerModal.tsx`
- `client/components/CookbookPickerModal.tsx`

Follow `docs/rules/performance.md`: destructure mutation methods/state instead of depending on mutation object identity.

## Dependencies

- None known.

## Risks

- Be careful not to change mutation behavior or navigation side effects while stabilizing references.

## Updates

### 2026-05-16

- Created from broad-sweep audit findings M3 and L3.
