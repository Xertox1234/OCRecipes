# Performance Rules

- Streaming bubble components must be in `ListFooterComponent`, not `renderItem` — streaming deps in `renderItem` re-render all visible FlatList rows on every token
- Inline `withOpacity` calls inside high-frequency animated components (>10 renders/sec) should be extracted to module-level constants — allocates new strings each tick
- `React.memo` with ref-only props creates a component that never updates — always include state or callback props that actually change in the comparison
- FlatList components must spread `FLATLIST_DEFAULTS` from `@/constants/performance` — missing `removeClippedSubviews`, `maxToRenderPerBatch`, `windowSize` degrades scroll performance
- Mutations objects passed as `useCallback` deps are new refs every render — destructure `.mutate`, `.isPending`, `.isError` individually
- Expensive derived values computed inside render (not memoized) at high tick rates (30s interval, streaming) should be wrapped in `useMemo`
