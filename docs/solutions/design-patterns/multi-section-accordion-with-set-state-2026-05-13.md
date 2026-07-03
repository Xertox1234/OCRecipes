---
title: Multi-section accordion with Set state (independent expand/collapse)
track: knowledge
category: design-patterns
module: client
tags: [react-native, accordion, set-state, lists]
applies_to: [client/screens/**/*.tsx, client/components/**/*.tsx]
created: '2026-05-13'
---

# Multi-section accordion with Set state (independent expand/collapse)

## When this applies

When multiple sections can be independently expanded/collapsed (unlike single-selection accordions that use `number | null`), use a `Set` for the expanded state. Initialize with a default via a factory function.

## Examples

```tsx
// client/screens/meal-plan/MealPlanHomeScreen.tsx
const [expandedSections, setExpandedSections] = useState<Set<MealType>>(
  () => new Set([getAutoExpandedMealType()]),
);

const handleToggleSection = useCallback(
  (mealType: MealType) => {
    haptics.impact(ImpactFeedbackStyle.Light);
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(mealType)) {
        next.delete(mealType);
      } else {
        next.add(mealType);
      }
      return next;
    });
  },
  [haptics],
);
```

## Why

**Key elements:**

- `useState<Set<T>>` with factory initializer `() => new Set([default])`
- Functional updater in toggle to avoid stale closures
- `getAutoExpandedMealType()` auto-selects the contextually relevant section (time-of-day)
- Section receives `isExpanded` boolean and `onToggle` callback

## Exceptions

When to use: any multi-section layout where users should be able to have multiple sections open simultaneously (e.g., meal sections, settings groups).

When NOT to use: single-selection accordions (FAQ, detail panels) — use `string | null` state instead.

## Related Files

- `client/screens/meal-plan/MealPlanHomeScreen.tsx` — meal section expand/collapse
- `client/screens/meal-plan/meal-plan-utils.ts` — `getAutoExpandedMealType()`

## See Also

- [Multi-select checkbox lists with Set<number>](multi-select-checkbox-set-state-2026-05-13.md)
- [Measure-then-animate collapsible height](measure-then-animate-collapsible-height-2026-05-13.md)
- [Two-tap expand-then-navigate for list items](two-tap-expand-then-navigate-list-items-2026-05-13.md)
