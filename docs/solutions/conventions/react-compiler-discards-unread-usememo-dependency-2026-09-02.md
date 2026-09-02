---
title: React Compiler discards a useMemo/useCallback dependency the callback never reads — use a state+effect recompute trigger instead
track: knowledge
category: conventions
tags: [react-compiler, performance, react-native, hooks, memoization]
module: client
applies_to: ["client/**/*.tsx", "client/**/*.ts"]
created: 2026-09-02
---

# React Compiler discards a useMemo/useCallback dependency the callback never reads — use a state+effect recompute trigger instead

## Rule

Never key a `useMemo`/`useCallback` dependency array on a value purely to force a
recompute at a specific moment (an "epoch"/"trigger" pattern) unless that value is
also **read inside the callback body**. With React Compiler active
(`app.json` → `experiments.reactCompiler: true`), the compiler ELIMINATES the
`useMemo`/`useCallback` call entirely and re-derives its own reactive dependencies
from static analysis of what the callback body actually reads — the literal array
you wrote is discarded, not enforced. A dependency that exists only in the array
and not in the body compiles to a compute-once-forever cache
(`if ($[0] === Symbol.for("react.memo_cache_sentinel"))`), silently reintroducing
whatever staleness bug the manual dependency was meant to fix.

When you need a value recomputed on a transition (e.g. "recompute when a sheet
opens") but the recompute logic itself doesn't need that value as an input, use
`useState` + a `useRef` tracking the previous trigger value + a `useEffect` whose
body reads the trigger (even just to compute the transition) and calls the state
setter conditionally. `useEffect` calls are NOT eliminated by the compiler — they
are preserved with a real, separately-tracked dependency array that React itself
compares at runtime, so `[trigger]` is honored there regardless of whether the
body reads it. (The body should still read the trigger for its own correctness —
to compute the open/close transition — but that is a different fact from what
makes the effect re-fire; a probe with an effect body that never reads the trigger
still compiled to a correctly-tracked deps array.)

## Smell patterns

- `useMemo(() => someComputation(), [someTriggerFlag])` where `someTriggerFlag`
  does not appear anywhere inside the arrow function body.
- A code comment describing a dependency as a "recompute trigger, not a data
  dependency" — that phrase is the signature of this exact anti-pattern.
- An `eslint-disable-line react-hooks/exhaustive-deps` suppressing an "unnecessary
  dependency" warning on a `useMemo`/`useCallback` — that lint warning is usually
  right, and suppressing it removes the one automated signal that would have
  caught this before the compiler silently discards the dependency at build time.

## Why

React Compiler's memoization is derived from **data-flow analysis of the callback
body**, not from the dependency array literal — the array is legacy React API
surface the compiler ignores once it takes over. This was confirmed empirically by
compiling both shapes with the project's pinned `babel-plugin-react-compiler`
(same `target: "19"` option `babel-preset-expo` uses):

```js
// useMemo(() => buildPlanSlotDays(new Date()), [isPlanSheetOpen]) — dep unread in body
if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
  t0 = buildPlanSlotDays(new Date());
  $[0] = t0; // computed exactly once for the component's lifetime
}
```

```js
// useEffect(() => { ...reads isPlanSheetOpen...; setPlanWeek(...) }, [isPlanSheetOpen])
let t2;
if ($[1] !== isPlanSheetOpen) { t2 = [isPlanSheetOpen]; $[1] = isPlanSheetOpen; $[2] = t2; }
useEffect(t1, t2); // real, correctly-tracked deps array, preserved by the compiler
```

Vitest does not run `babel-plugin-react-compiler` (`vitest.config.ts` uses
`esbuild: { jsx: "automatic" }` with no Babel/compiler plugin in the test
transform), so a `useMemo(fn, [unreadTrigger])` "fix" passes green under the test
suite — real React's `useMemo` honors the literal array — while the actual
EAS-built app (compiled through `babel-preset-expo`, which wires the compiler)
silently keeps the original bug. This is a false-negative class that no amount of
additional Vitest coverage closes; only compiling the shape through the actual
pinned compiler (or an integration/E2E check against a real build) can catch it.

## Examples

```typescript
// BAD — compiler discards `isPlanSheetOpen`; computed once, forever
const planWeek = useMemo(
  () => buildPlanSlotDays(new Date()),
  [isPlanSheetOpen], // never read below — silently dropped by React Compiler
);

// GOOD — useEffect's deps array survives compilation regardless of body reads;
// mirrors PlanSlotPickerSheet.tsx's own false->true `visible` recompute pattern
const [planWeek, setPlanWeek] = useState(() => buildPlanSlotDays(new Date()));
const prevPlanSheetOpenRef = useRef(isPlanSheetOpen);
useEffect(() => {
  const opened = isPlanSheetOpen && !prevPlanSheetOpenRef.current;
  prevPlanSheetOpenRef.current = isPlanSheetOpen;
  if (opened) {
    setPlanWeek(buildPlanSlotDays(new Date()));
  }
}, [isPlanSheetOpen]);
```

## Exceptions

- A `useMemo`/`useCallback` whose dependency IS read inside the callback body is
  unaffected — the compiler correctly derives reactivity from that read, and the
  manual array is redundant (see the existing
  `react-compiler-memoization-audits-2026-06-10.md` rule: don't add manual memo
  for identity stability the compiler already provides).
- Values consumed by a class-component internal (e.g. `FlatList`/`VirtualizedList`
  `extraData`) still need a real `useMemo`, because the compiler does not protect
  a class component's own `PureComponent` compare — this is unrelated to the
  unread-dependency hazard here.

## Related Files

- `client/components/coach/CoachChat.tsx` — `planWeek` state/effect (the fix)
- `client/components/coach/PlanSlotPickerSheet.tsx` — the pre-existing
  `prevVisibleRef` effect this pattern mirrors
- `app.json` (`experiments.reactCompiler`)
- `babel.config.js` (`babel-preset-expo`, which wires `babel-plugin-react-compiler`)

## See Also

- [React Compiler is active — how it changes memoization findings and fixes](../best-practices/react-compiler-memoization-audits-2026-06-10.md)
