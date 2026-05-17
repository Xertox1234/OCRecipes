---
title: "Destructure mutation members in GroceryListPickerModal"
status: done
priority: low
created: 2026-05-17
updated: 2026-05-17
assignee:
labels: [deferred, performance, hooks, react-native]
github_issue:
---

# Destructure Mutation Members in GroceryListPickerModal

## Summary

`GroceryListPickerModal.tsx` holds `useCreateGroceryList()` and
`useAddManualGroceryItem()` as whole-object references (`createList`,
`addItem`). `addItem` is a `useCallback` dep of `handleAddToList`, which is in
turn a dep of `renderItem` — a FlatList render path. Mutation objects get a new
identity every render, so this cascades extra `renderItem` re-creations.

## Background

Found while executing `todos/2026-05-16-list-render-performance-cleanups.md`
(already completed in PR #197). The sibling files (`CookbookPickerModal`,
`ChatListScreen`, `GroceryListsScreen`) were destructured in that PR, but
`GroceryListPickerModal` was left with whole-object mutation references. This
is a genuine residual instance of audit finding M3 — destructuring it was out
of scope for that already-merged todo, so it is filed separately here.

## Acceptance Criteria

- [ ] Destructure `useCreateGroceryList()` into `mutate`/`isPending` members in `GroceryListPickerModal`.
- [ ] Destructure `useAddManualGroceryItem()` into `mutate`/`isPending` members in `GroceryListPickerModal`.
- [ ] Update `handleAddToList`, `handleCreateAndAdd`, `renderItem`, and the JSX that reads `createList.isPending` / `addItem.isPending` to use the destructured members.
- [ ] No change to mutation behavior, error handling, or navigation side effects.
- [ ] Run targeted typecheck for the touched file.

## Implementation Notes

Relevant file:

- `client/components/GroceryListPickerModal.tsx`

Follow `docs/rules/performance.md`: "Mutations objects passed as `useCallback`
deps are new refs every render — destructure `.mutate`, `.isPending`,
`.isError` individually." `CookbookPickerModal.tsx` already follows this
pattern (`const { mutate: addRecipeMutate, isPending: isAdding } = ...`) and is
the reference shape.

## Dependencies

- None known.

## Risks

- The `isAdding` flag (`addItem.isPending`) gates `Pressable` disabled state and
  row opacity — preserve that exact behavior when switching to the destructured
  `isPending`.

## Updates

### 2026-05-17

- Created while executing the already-merged list-render-performance-cleanups
  todo; this is the one residual M3 instance not covered by PR #197.
