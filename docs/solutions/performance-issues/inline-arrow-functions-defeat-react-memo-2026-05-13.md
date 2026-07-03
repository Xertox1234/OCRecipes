---
title: Inline Arrow Functions in renderItem Defeat React.memo
track: bug
category: performance-issues
module: client
severity: medium
tags: [react, memo, flatlist, performance, callbacks, react-native]
symptoms: [Every row in a memoized FlatList re-renders on every parent state change, Scroll jank scales with list length, React DevTools 'Highlight updates' shows full-list flashes even when one item changed]
applies_to: [client/screens/**/*.tsx, client/components/**/*.tsx]
created: '2026-02-12'
---

# Inline Arrow Functions in renderItem Defeat React.memo

## Problem

`HistoryScreen` passed inline arrow functions (e.g., `() => toggleFavourite.mutate(item.id)`) to each memoized `HistoryItem` in `renderItem`. Despite `React.memo`, every item re-rendered on every parent render because arrow function props were always new references. With 5 callbacks per item, the performance impact scaled with list length.

## Symptoms

- A list with `React.memo` on its row component still re-renders every row on parent state changes.
- React DevTools "Highlight updates while rendering" flashes the entire list, not just the changed row.
- Frame drops correlate with list length, not with how many items actually changed.

## Root Cause

`React.memo` performs a shallow prop comparison. An inline arrow function in `renderItem` is a **new reference on every render of the parent**, so `prevProps.onPress !== nextProps.onPress` for every row, and memoization is bypassed.

```typescript
// ❌ Bug: new arrow per render → memo bypassed
<FlatList
  data={items}
  renderItem={({ item }) => (
    <HistoryItem
      item={item}
      onFavourite={() => toggleFavourite.mutate(item.id)}
      onDiscard={() => discard.mutate(item.id)}
      onEdit={() => navigate("Edit", { id: item.id })}
      onShare={() => share(item)}
      onTap={() => navigate("Detail", { id: item.id })}
    />
  )}
/>
```

Each row receives 5 fresh function references per parent render. `React.memo` sees prop changes, re-renders. With 50 rows and 5 callbacks each, that's 250 wasted equality checks plus 50 wasted reconciliations per parent render.

## Solution

Define callbacks **once in the parent** with the item's ID as a parameter, then pass the stable callback plus the ID to each row. Move ID-binding inside the row component:

```typescript
// ✅ Stable callbacks; ID passed as data
const handleFavourite = useCallback(
  (id: number) => toggleFavourite.mutate(id),
  [toggleFavourite],
);
const handleDiscard = useCallback(
  (id: number) => discard.mutate(id),
  [discard],
);
// ...etc

<FlatList
  data={items}
  renderItem={({ item }) => (
    <HistoryItem
      item={item}
      onFavourite={handleFavourite}
      onDiscard={handleDiscard}
      onEdit={handleEdit}
      onShare={handleShare}
      onTap={handleTap}
    />
  )}
/>;

// Inside HistoryItem (memo):
const handlePressFavourite = useCallback(
  () => onFavourite(item.id),
  [onFavourite, item.id],
);
```

Now the row's prop references are stable; memo compares them as equal across renders that don't touch the row's data.

## Prevention

- For any `React.memo` row, **never define handler props inline in the parent's `renderItem`**. Use a parameterized `(id: T) => void` callback created once in the parent.
- Verify memoization with React DevTools "Highlight updates while rendering" — a memoized list should flash only changed rows.
- Lint rule candidate: forbid arrow expressions as prop values inside `renderItem` when the child is wrapped in `React.memo`.

## Related Files

- `client/screens/HistoryScreen.tsx:785` — fixed renderer
- `client/components/HistoryItemActions.tsx` — row component receiving stable callbacks

## See Also

- `docs/legacy-patterns/react-native.md` — "Parameterized ID Callbacks for Memoized List Items"
