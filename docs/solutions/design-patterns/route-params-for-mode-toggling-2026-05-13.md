---
title: "Route params for screen mode toggling"
track: knowledge
category: design-patterns
tags: [react-native, navigation, route-params, screen-modes]
module: client
applies_to: ["client/screens/**/*.tsx"]
created: 2026-05-13
---

# Route params for screen mode toggling

## When this applies

Use route params to toggle between screen modes (dashboard vs full view, list vs detail, compact vs expanded) instead of creating separate screens with 90% duplication.

## Examples

```typescript
// Good: Single screen with mode param (HistoryScreen.tsx)
type HistoryScreenRouteProp = RouteProp<
  { History: { showAll?: boolean } },
  "History"
>;

export default function HistoryScreen() {
  const route = useRoute<HistoryScreenRouteProp>();
  const showAll = route.params?.showAll ?? false;

  // Conditional rendering based on mode
  if (showAll) {
    return <FullHistoryView onBack={() => navigation.setParams({ showAll: false })} />;
  }

  return <DashboardView onViewAll={() => navigation.setParams({ showAll: true })} />;
}
```

```typescript
// Bad: Separate screens for each mode
// HistoryDashboardScreen.tsx
// FullHistoryScreen.tsx
// Duplicates shared logic, state management, and navigation setup
```

## Why

- Shared state and queries (no refetch when switching modes)
- Cleaner navigation stack (back button works naturally)
- Single source of truth for the data

## Exceptions

When to use:

- Dashboard + expanded view (Today dashboard vs full history)
- List view + detail view in same context
- Compact + expanded modes of same data

When NOT to use:

- Modes with genuinely different fields, validation, or layouts — use separate screens

## Related Files

- `client/screens/HistoryScreen.tsx` — dashboard/full toggle via `showAll` param

## See Also

- [Unified create/edit screen via optional param](unified-create-edit-screen-optional-param-2026-05-13.md)
- [Unified modal with type discriminator](unified-modal-with-type-discriminator-2026-05-13.md)
