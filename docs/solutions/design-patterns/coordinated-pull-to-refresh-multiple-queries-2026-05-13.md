---
title: "Coordinated pull-to-refresh for multiple queries"
track: knowledge
category: design-patterns
tags: [react-native, tanstack-query, refresh, async, ui-state]
module: client
applies_to: ["client/screens/**/*.tsx"]
created: 2026-05-13
---

# Coordinated pull-to-refresh for multiple queries

## When this applies

When a screen fetches data from multiple endpoints, coordinate refresh with `Promise.all` so the UI updates atomically when all data is ready.

## Examples

```typescript
const {
  data: summaryData,
  refetch: refetchSummary,
} = useQuery<DailySummaryResponse>({
  queryKey: ["/api/daily-summary"],
});

const {
  data: itemsData,
  refetch: refetchItems,
} = useInfiniteQuery<PaginatedResponse<ScannedItemResponse>>({
  queryKey: ["/api/scanned-items"],
});

const [refreshing, setRefreshing] = useState(false);

const handleRefresh = useCallback(async () => {
  setRefreshing(true);
  try {
    // Refresh all queries in parallel
    await Promise.all([refetchSummary(), refetchItems()]);
  } finally {
    setRefreshing(false);
  }
}, [refetchSummary, refetchItems]);

return (
  <FlatList
    refreshing={refreshing}
    onRefresh={handleRefresh}
    // ...
  />
);
```

## Why

Individual `refetch()` calls would cause jarring partial updates. Coordinated refresh ensures the UI updates atomically when all data is ready.

## Exceptions

When to use:

- Dashboard screens with stats + list data
- Profile screens with user info + activity data
- Any screen combining data from multiple API calls

## See Also

- [Pull-to-refresh completion haptics](pull-to-refresh-completion-haptics-2026-05-13.md)
