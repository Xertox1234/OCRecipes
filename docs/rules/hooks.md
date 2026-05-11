# Hooks Rules

- Destructure `.mutate` (not the whole mutation object) for `useCallback` deps — the full mutation object is a new ref every render, defeating memoization
- Never list streaming state (`streamingContent`, `statusText`, `streamBlocks`) in `FlatList` `renderItem` `useCallback` deps — use `ListFooterComponent` instead; streaming deps cause full FlatList re-render on every token (~20×/sec)
- Values that change over time (phase, reducedMotion, etc.) used inside a zero-dep `useCallback` must be mirrored to a ref: `const fooRef = useRef(foo); useEffect(() => { fooRef.current = foo; }, [foo]);`
- Effect cleanup must capture timer/subscription refs at cleanup time (inside the effect return), not at setup time — closures capture stale values
- `cancelAnimation` must be called when `reducedMotion` toggles at runtime — `withRepeat` animations don't stop on their own; use `else` (not `else if`) for the cancel branch to avoid dead zones
