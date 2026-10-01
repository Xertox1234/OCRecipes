---
title: Lifted filter state with presentational bottom sheet
track: knowledge
category: design-patterns
module: client
tags: [react-native, state-management, bottom-sheet, filters, lifting-state]
applies_to: [client/components/**/*.tsx, client/screens/**/*.tsx]
created: '2026-05-13'
last_updated: '2026-09-25'
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

### Nesting the sheet's own fields when the parent owns more filter state than the sheet

When the parent screen also owns filter state *outside* the presentational sheet's own fields (e.g. chip-row toggles like `cuisine`, `diet`, `difficulty`, `curatedOnly`, `safeForMe`, `pantryMode`, alongside the sheet's own `SearchFilters`-shaped fields like `sort`, `maxPrepTime`, `maxCalories`, `minProtein`, `source`), **do not** flatten everything into one object with the sheet's own field names at the top level. Instead nest the sheet's own fields under a named sub-key (e.g. `advanced: SearchFilters`) inside the parent's single consolidated filters object.

This approach:

- Keeps the presentational sheet's existing prop type/contract completely untouched — it still receives `filters: SearchFilters` and fires `onFiltersChange(nextFilters: SearchFilters)`.
- Guarantees that the sheet's own `onReset`/`onFiltersChange` handlers can only ever read or replace that one sub-object:
  ```typescript
  setFilters(prev => ({ ...prev, advanced: nextFilters }));
  ```
- Prevents the sheet's reset-to-defaults call from accidentally spreading over or clearing the chip-row fields that live outside the sheet — a flat single-level object would let the sheet's own reset silently wipe filter state it doesn't even render, which is a real behavior regression, not just a style choice.

**Implementation pattern** (`client/screens/meal-plan/recipe-browser-utils.ts` / `RecipeBrowserScreen.tsx`):

```typescript
// Parent's consolidated filter state
interface RecipeFilters {
  // Chip-row toggles (owned by parent, not by sheet) — single-select, not arrays
  activeCuisine: string | undefined;
  activeDiet: string | undefined;
  activeDifficulty: string | undefined;
  curatedOnly: boolean;
  safeForMe: boolean;
  pantryMode: boolean;

  // Sheet's own fields — nested under 'advanced'
  advanced: SearchFilters;
}

const DEFAULT_FILTERS: RecipeFilters = {
  activeCuisine: undefined,
  activeDiet: undefined,
  activeDifficulty: undefined,
  curatedOnly: false,
  safeForMe: false,
  pantryMode: false,
  advanced: {
    sort: 'relevance',
    maxPrepTime: undefined,
    maxCalories: undefined,
    minProtein: undefined,
    source: 'all',
  },
};

// Inside the screen:
const [filters, setFilters] = useState<RecipeFilters>(DEFAULT_FILTERS);

// Pure derivation lives in *-utils.ts so it's independently testable.
// It reads BOTH the advanced sub-object's fields AND any chip-row fields
// that should count toward the badge (here curatedOnly/safeForMe do;
// activeCuisine/activeDiet/activeDifficulty/pantryMode deliberately don't
// — that's a per-screen choice, not a rule this pattern imposes). The
// memo depends on the whole `filters` object, matching however broadly
// the pure function reads from it.
const activeFilterCount = useMemo(
  () => computeActiveFilterCount(filters),
  [filters],
);

// Pass the nested sub-object to the sheet
<SearchFilterSheet
  filters={filters.advanced}
  onFiltersChange={(nextAdvanced) =>
    setFilters(prev => ({ ...prev, advanced: nextAdvanced }))
  }
  onReset={() =>
    setFilters(prev => ({ ...prev, advanced: DEFAULT_FILTERS.advanced }))
  }
  activeFilterCount={activeFilterCount}
/>
```

This keeps the sheet component completely ignorant of chip-row state and eliminates the risk of accidental cross-contamination.

## Exceptions

When to use: any list screen with a filter bottom sheet (recipe search, product catalog, activity log filters).

## Related Files

- `client/components/meal-plan/SearchFilterSheet.tsx`
- `client/screens/meal-plan/RecipeBrowserScreen.tsx`
- `client/screens/meal-plan/recipe-browser-utils.ts`

## See Also

- [Slider live SR feedback pattern](slider-live-sr-feedback-pattern-2026-05-13.md)
