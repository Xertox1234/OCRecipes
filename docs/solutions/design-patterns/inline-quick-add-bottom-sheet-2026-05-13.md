---
title: "Inline quick-add bottom sheet with search and tap-to-add"
track: knowledge
category: design-patterns
tags: [react-native, bottom-sheet, search, lightweight-flow]
module: client
applies_to: ["client/components/**/*.tsx", "client/screens/**/*.tsx"]
created: 2026-05-13
---

# Inline quick-add bottom sheet with search and tap-to-add

## When this applies

For lightweight add flows, use a `BottomSheetModal` with search + tap-to-add instead of navigating to a full-screen browser. This keeps the user's context visible and reduces navigation depth.

## Examples

```tsx
// client/components/meal-plan/QuickAddSheet.tsx
interface QuickAddSheetProps {
  mealType: MealType | null; // null = sheet is closed
  plannedDate: string;
  onDismiss: () => void;
  onNavigateCreate: (mealType: MealType, plannedDate: string) => void;
  onNavigateImport: (mealType: MealType, plannedDate: string) => void;
}

// Parent state controls visibility
const [quickAddMealType, setQuickAddMealType] = useState<MealType | null>(null);

// Open: set meal type (sheet reads it in useEffect and calls .present())
const handleAddItem = (mealType: MealType) => setQuickAddMealType(mealType);

// Close: clear meal type
const handleDismiss = () => setQuickAddMealType(null);
```

## Why

**Key elements:**

- `mealType: null` = closed, non-null = open for that type. Sheet calls `present()`/`dismiss()` in a `useEffect` on `mealType`.
- Debounced search (300ms) with `useUnifiedRecipes()` — shows personal recipes by default, combined results when searching
- Tap anywhere on a result row → `addItemMutation` + dismiss (no confirm step)
- Footer actions navigate to full create/import screens with `returnToMealPlan` param
- `BottomSheetFlatList` + `BottomSheetTextInput` for proper scroll/keyboard handling inside sheets

## Related Files

- `client/components/meal-plan/QuickAddSheet.tsx` — full implementation
- `client/screens/meal-plan/MealPlanHomeScreen.tsx` — integration with `quickAddMealType` state

## See Also

- [Return-to-origin navigation flow](return-to-origin-navigation-flow-2026-05-13.md)
- [Async mutation double-tap guard](async-mutation-double-tap-guard-2026-05-13.md)
- [enableDynamicSizing for minimal-content sheets](enable-dynamic-sizing-minimal-content-sheets-2026-05-13.md)
