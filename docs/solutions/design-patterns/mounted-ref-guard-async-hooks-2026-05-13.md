---
title: "Mounted ref guard for async hooks"
track: knowledge
category: design-patterns
tags:
  [react, hooks, async, useref, setstate-after-unmount, iap, abort-controller]
module: client
applies_to: ["client/hooks/**/*.ts", "client/lib/**/*.ts"]
created: 2026-05-13
---

# Mounted ref guard for async hooks

## When this applies

For hooks with multi-step async flows that cross library boundaries — store dialogs, server validation, transaction finishing, file pickers — where any step may complete _after_ the consuming component unmounts. The flow cannot be cancelled (no native cancel API, no aborted-await semantics), so the only safe move is to discard the result.

## Why

`setState` after unmount produces React warnings and can mask real bugs (a stale handler firing after navigation). `AbortController` only works for fetch-style cancellation; it cannot stop:

- A store dialog already presented to the user.
- A `finishTransaction` call inside an IAP SDK.
- A native picker that has already returned.

A `mountedRef` + `safeSetState` wrapper lets the async chain run to completion but silently drops state updates if the component is gone. Cheaper and more reliable than trying to thread cancellation through every library.

## Examples

```typescript
export function usePurchase() {
  const [state, setState] = useState<PurchaseState>({ status: "idle" });
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const safeSetState = useCallback((newState: PurchaseState) => {
    if (mountedRef.current) {
      setState(newState);
    }
  }, []);

  // All async flows use safeSetState instead of setState
  const purchase = useCallback(async () => {
    safeSetState({ status: "loading" });
    try {
      // ... long async chain (store dialog, server validation, finishTransaction)
      safeSetState({ status: "success" });
    } catch (error) {
      safeSetState({ status: "error", error: mapIAPError(error) });
    }
  }, [safeSetState]);

  return { state, purchase };
}
```

### Why explicitly set `mountedRef.current = true` in the effect

Refs persist across re-renders. In React 18+ strict mode, the effect runs setup → cleanup → setup again on mount. Without the explicit `= true`, the second mount sees the ref as `false` (from the first cleanup) and every `safeSetState` is dropped. Always set `true` at the start of the effect, not just at `useRef(true)` initialization.

### Use `safeSetState` consistently

Never call raw `setState` in an async callback once the pattern is in place — mixing the two re-introduces the bug.

## Exceptions

For single-step async flows that already have an `AbortController` (a single `fetch`, a single `cancellable-promise`), prefer cancellation. The mounted-ref guard is for chains where cancellation is impossible.

## Related Files

- `client/lib/iap/usePurchase.ts` — original implementation

## See Also

- [`__DEV__` conditional require for mock vs real module switching](dev-conditional-require-mock-vs-real-module-2026-05-13.md) — same module (IAP); the conditional require provides the mock that `usePurchase` consumes
- [Stale closure in React callbacks — use refs for synchronous checks](../logic-errors/stale-closure-callback-refs.md) — related ref-as-guard pattern
