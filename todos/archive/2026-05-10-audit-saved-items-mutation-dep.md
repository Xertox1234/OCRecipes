---
title: "SavedItemsScreen: destructure mutate from useDeleteSavedItem instead of whole object"
status: done
priority: low
created: 2026-05-10
updated: 2026-05-10
assignee:
labels: [performance, react-native]
github_issue:
---

# SavedItemsScreen: destructure mutate from useDeleteSavedItem

## Summary

`deleteMutation` (the full TanStack Query mutation object) is listed as a dep of `handleSwipeDelete`. The mutation object is recreated on every status change (idle→loading→success→idle), causing `handleSwipeDelete` and `renderItem` to be recreated mid-delete animation, invalidating `React.memo` on all visible list items.

## Background

Audit 2026-05-10, finding M3. File: `client/screens/SavedItemsScreen.tsx:133`.

## Acceptance Criteria

- [ ] `const { mutate: deleteItem } = useDeleteSavedItem()` destructuring used
- [ ] `handleSwipeDelete` callback uses `deleteItem` with `deleteItem` as dep (stable reference)
- [ ] No regression in swipe-to-delete behavior

## Implementation Notes

```typescript
// Before
const deleteMutation = useDeleteSavedItem();
const handleSwipeDelete = useCallback(
  (item) => deleteMutation.mutate(item.id),
  [deleteMutation],
);

// After
const { mutate: deleteItem } = useDeleteSavedItem();
const handleSwipeDelete = useCallback(
  (item) => deleteItem(item.id),
  [deleteItem],
);
```

## Updates

### 2026-05-10

- Deferred from audit 2026-05-10 (M3)
