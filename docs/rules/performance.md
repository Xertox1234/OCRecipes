# Performance Rules

- Streaming bubble components must be in `ListFooterComponent`, not `renderItem` — streaming deps in `renderItem` re-render all visible FlatList rows on every token
- Inline `withOpacity` calls inside high-frequency animated components (>10 renders/sec) should be extracted to module-level constants — allocates new strings each tick
- Don't rely on `React.memo` when all deps are refs — ref identity is stable so the memo never re-renders on value changes inside the ref; include actual state or primitive props in the comparison
- FlatList components must spread `FLATLIST_DEFAULTS` from `@/constants/performance` — missing `removeClippedSubviews`, `maxToRenderPerBatch`, `windowSize` degrades scroll performance
- Mutations objects passed as `useCallback` deps are new refs every render — destructure `.mutate`, `.isPending`, `.isError` individually
- Expensive derived values computed inside render (not memoized) at high tick rates (30s interval, streaming) should be wrapped in `useMemo`
- When FlatList rows track ref-based state (e.g., `useRef<Set>` for used/accepted items), never include version counter state in `renderItem`'s `useCallback` deps — pass counters via `extraData` instead; the `data` prop change already drives re-renders for new items, `extraData` drives re-renders for changed display state on existing items
- React Compiler is ACTIVE (`app.json` `experiments.reactCompiler` + `babel-plugin-react-compiler` via babel-preset-expo) — do NOT add `React.memo`/`useCallback`/`useMemo` purely for identity stability consumed by function components; DO still `useMemo` values feeding class-component PureComponent props (`FlatList` `extraData` — the compiler does not protect VirtualizedList's internal compare), and treat components with ref reads during render as plausible compiler bailouts where manual memoization stays load-bearing. See `docs/solutions/best-practices/react-compiler-memoization-audits-2026-06-10.md`
