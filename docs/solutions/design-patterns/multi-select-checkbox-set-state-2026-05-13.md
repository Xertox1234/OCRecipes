---
title: Multi-select checkbox lists with Set<number> for O(1) lookup
track: knowledge
category: design-patterns
module: client
tags: [react-native, accessibility, lists, selection, haptics]
applies_to: [client/screens/**/*.tsx, client/components/**/*.tsx]
created: '2026-05-13'
---

# Multi-select checkbox lists with Set<number> for O(1) lookup

## When this applies

For lists where users can select/deselect individual items (photo analysis results, batch operations, shopping lists), track the selected indices in a `Set<number>` rather than an array. `Set.has()` is O(1) and React state updates are simple — clone the Set, mutate, return.

## Examples

```typescript
// State: Track selected indices with Set for efficient lookup
const [selectedItems, setSelectedItems] = useState<Set<number>>(new Set());

// Initialize all items as selected when data arrives
useEffect(() => {
  if (items.length > 0) {
    setSelectedItems(new Set(items.map((_, i) => i)));
  }
}, [items.length]); // See "Intentional useEffect Dependencies" pattern

// Toggle with haptic feedback
const toggleItemSelection = (index: number) => {
  haptics.selection();
  setSelectedItems((prev) => {
    const updated = new Set(prev);
    if (updated.has(index)) {
      updated.delete(index);
    } else {
      updated.add(index);
    }
    return updated;
  });
};

// In component - checkbox with accessibility
<Pressable
  onPress={() => toggleItemSelection(index)}
  accessibilityRole="checkbox"
  accessibilityState={{ checked: selectedItems.has(index) }}
  hitSlop={{ top: 11, bottom: 11, left: 11, right: 11 }} // 44x44 touch target
>
  <Feather
    name={selectedItems.has(index) ? "check-square" : "square"}
    size={22}
    color={selectedItems.has(index) ? theme.success : theme.textSecondary}
  />
</Pressable>

// Visual dimming for unselected items
<Card style={[styles.card, !isSelected && { opacity: 0.6 }]}>
```

## Why

`Set` provides O(1) membership testing, which matters at scale (50+ photo-analyzed items). The functional updater (`setSelectedItems(prev => ...)`) avoids stale state when the toggle fires faster than React can re-render. Cloning to a new `Set` is required — React identity-compares state to decide whether to re-render; mutating in place skips the render.

## Exceptions

- Single-select lists — use `string | null` state instead.
- Multi-section accordion where a default section should be expanded on mount — initialize via a factory function (see [Multi-section accordion with Set state](multi-section-accordion-with-set-state-2026-05-13.md)).

## Related Files

- `docs/rules/react-native.md` — touch-target rule (`hitSlop`)

## See Also

- [Multi-section accordion with Set state](multi-section-accordion-with-set-state-2026-05-13.md)
- [Accessibility props pattern](accessibility-props-pattern-2026-05-13.md)
