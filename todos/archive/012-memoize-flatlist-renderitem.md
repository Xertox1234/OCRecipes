---
title: "Memoize FlatList renderItem in HistoryScreen"
status: complete
priority: medium
created: 2026-01-30
updated: 2026-01-30
assignee:
labels: [performance, react-native, code-review]
---

# Memoize FlatList renderItem

## Summary

The `renderItem` function in HistoryScreen creates new function references on every render, causing all list items to re-render unnecessarily.

## Background

**Location:** `client/screens/HistoryScreen.tsx:249-261`

```typescript
const renderItem = ({
  item,
  index,
}: {
  item: ScannedItem;
  index: number;
}) => (
  <HistoryItem
    item={item}
    index={index}
    onPress={() => handleItemPress(item)}  // New function every render
  />
);
```

Also, inline `ItemSeparatorComponent` (line 286):
```typescript
ItemSeparatorComponent={() => <View style={{ height: Spacing.md }} />}
```

This causes all visible list items to re-render on every parent render.

## Acceptance Criteria

- [ ] Wrap HistoryItem in React.memo
- [ ] Use useCallback for handleItemPress
- [ ] Use useCallback for renderItem
- [ ] Extract ItemSeparator to memoized component
- [ ] Pass stable references to list items

## Implementation Notes

```typescript
// Extract separator outside component
const ItemSeparator = React.memo(() => (
  <View style={{ height: Spacing.md }} />
));

// Inside component:
const handleItemPress = useCallback((item: ScannedItem) => {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  navigation.navigate("ItemDetail", { itemId: item.id });
}, [navigation]);

const renderItem = useCallback(({ item, index }: {
  item: ScannedItem;
  index: number
}) => (
  <HistoryItem
    item={item}
    index={index}
    onPress={handleItemPress}
  />
), [handleItemPress]);
```

```typescript
// HistoryItem component
const HistoryItem = React.memo(function HistoryItem({ ... }) {
  // ...
});
```

## Dependencies

- None

## Risks

- None - optimization only

## Updates

### 2026-01-30
- Initial creation from code review
