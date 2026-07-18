---
title: Intentional useEffect dependencies — document the WHY
track: knowledge
category: conventions
module: client
tags: [react, hooks, useeffect, eslint, comments]
applies_to: [client/**/*.ts, client/**/*.tsx]
created: '2026-05-13'
---

# Intentional useEffect dependencies — document the WHY

## Rule

When you deliberately use a derived value (like `array.length`) instead of the array itself in a `useEffect` dependency, document WHY in a comment above the effect to prevent "fixes" that break the intended behavior. If you suppress `react-hooks/exhaustive-deps`, always explain WHY in a comment above the `useEffect`.

## Examples

```typescript
// Good: Clear comment explaining the intentional choice
// Initialize all items as selected when foods array populates.
// We intentionally only track foods.length (not the foods array reference) because:
// 1. handleEditFood creates new array references but preserves length
// 2. We only want to reset selections when AI analysis returns NEW foods
// 3. This avoids resetting user's selections when they edit food names
useEffect(() => {
  if (foods.length > 0) {
    setSelectedItems(new Set(foods.map((_, i) => i)));
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [foods.length]);
```

```typescript
// Bad: Suppressing lint without explanation invites "fixes"
useEffect(() => {
  if (foods.length > 0) {
    setSelectedItems(new Set(foods.map((_, i) => i)));
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [foods.length]); // Future dev: "Why not [foods]? Let me fix this..."
```

## Why

An unexplained `eslint-disable-next-line` line reads as a defect to anyone scanning the code later. The natural "fix" is to add the array reference to the dep list — which causes the effect to re-run every time the array identity changes, undoing the intended behavior. A comment converts the suppression from a smell into a reasoned choice.

## Related Files

- `client/screens/PhotoAnalysisScreen.tsx` — selection reset effect

## See Also

- [Multi-select checkbox lists with Set<number>](../design-patterns/multi-select-checkbox-set-state-2026-05-13.md)
- [Reset derived state on prop change](reset-derived-state-on-prop-change-2026-05-13.md)
- [DRY-ing a fresh-per-render object into a useEffect](per-render-object-into-effect-deps-dry-trap-2026-07-17.md) — the same family from the other direction: a "cleanup" that puts a per-render identity into the deps array
