---
title: Lifted filter state with presentational bottom sheet
track: knowledge
category: design-patterns
module: client
tags: [react-native, state-management, bottom-sheet, filters, lifting-state]
applies_to: [client/components/**/*.tsx, client/screens/**/*.tsx]
created: '2026-05-13'
---

# Lifted filter state with presentational bottom sheet

## When this applies

When a bottom sheet provides advanced filtering for a list screen, keep all filter state in the parent screen — not inside the sheet. The sheet is purely presentational: it receives current filters and fires callbacks. This keeps the sheet reusable, testable, and avoids stale-state bugs from sheet mounting/unmounting.

## Examples

```typescript
// Parent screen — owns the state
const [advancedFilters, setAdvancedFilters] = useState<SearchFilters>({
  sort: "relevance",
  maxPrepTime: undefined,
  maxCalories: undefined,
  minProtein: undefined,
  source: "all",
});
const filterSheetRef = React.useRef<BottomSheetModal>(null);

// Derived badge count
const activeFilterCount = useMemo(() => {
  let count = 0;
  if (advancedFilters.sort !== "relevance") count++;
  if (advancedFilters.maxPrepTime !== undefined) count++;
  if (advancedFilters.maxCalories !== undefined) count++;
  if (advancedFilters.minProtein !== undefined) count++;
  if (advancedFilters.source !== "all") count++;
  return count;
}, [advancedFilters]);
```

```tsx
// Sheet component — purely presentational, no internal state
interface SearchFilterSheetProps {
  filters: SearchFilters;
  onFiltersChange: (filters: SearchFilters) => void;
  onReset: () => void;
  activeFilterCount: number;
}

export function SearchFilterSheet({
  filters,
  onFiltersChange,
  onReset,
  activeFilterCount,
}: SearchFilterSheetProps) {
  // Renders chips, sliders, reset button — all driven by props
}
```

```tsx
// Filter icon button with badge — opens the sheet
<Pressable onPress={() => filterSheetRef.current?.present()}>
  <Feather name="sliders" size={16} color={theme.link} />
  {activeFilterCount > 0 && (
    <View style={styles.filterBadge}>
      <ThemedText style={styles.filterBadgeText}>
        {activeFilterCount}
      </ThemedText>
    </View>
  )}
</Pressable>
```

## Why

**Key rules:**

- **State in parent, not sheet:** The sheet reads `filters` prop and calls `onFiltersChange` — it never calls `useState` for filter values
- **Badge count is derived:** Compute `activeFilterCount` as a `useMemo` comparing current filters to defaults — don't track it as separate state
- **Reset clears to defaults:** The parent's `onReset` handler resets to the default `SearchFilters` object, not to empty/null
- **Sheet is a BottomSheetModal child:** Wrap in `<BottomSheetView>` inside `<BottomSheetModal>`, placed at the end of the screen's return

## Exceptions

When to use: any list screen with a filter bottom sheet (recipe search, product catalog, activity log filters).

## Related Files

- `client/components/meal-plan/SearchFilterSheet.tsx`
- `client/screens/meal-plan/RecipeBrowserScreen.tsx`

## See Also

- [Slider live SR feedback pattern](slider-live-sr-feedback-pattern-2026-05-13.md)
