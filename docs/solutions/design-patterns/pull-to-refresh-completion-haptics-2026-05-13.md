---
title: "Pull-to-refresh completion haptics"
track: knowledge
category: design-patterns
tags: [react-native, haptics, refresh, ux]
module: client
applies_to: ["client/screens/**/*.tsx"]
created: 2026-05-13
---

# Pull-to-refresh completion haptics

## When this applies

Add a light haptic impact when pull-to-refresh completes so users know data has finished loading.

## Examples

```typescript
// For screens using refetch directly:
<RefreshControl
  refreshing={isRefetching}
  onRefresh={() => refetch().then(() => haptics.impact())}
/>

// For screens with custom handleRefresh:
const handleRefresh = useCallback(async () => {
  await Promise.all([refetchA(), refetchB()]);
  haptics.impact(); // Light tap on completion
}, [refetchA, refetchB, haptics]);
```

`haptics.impact()` defaults to `ImpactFeedbackStyle.Medium` — a subtle confirmation without being jarring.

## Related Files

- All 9 refreshable screens: HomeScreen, SavedItemsScreen, HistoryScreen, MealPlanHomeScreen, FastingScreen, ChatListScreen, GroceryListScreen, PantryScreen, GLP1CompanionScreen

## See Also

- [Coordinated pull-to-refresh for multiple queries](coordinated-pull-to-refresh-multiple-queries-2026-05-13.md)
- [Haptic feedback on user actions](../conventions/haptic-feedback-on-user-actions-2026-05-13.md)
- [Accessibility-aware haptics pattern](accessibility-aware-haptics-pattern-2026-05-13.md)
