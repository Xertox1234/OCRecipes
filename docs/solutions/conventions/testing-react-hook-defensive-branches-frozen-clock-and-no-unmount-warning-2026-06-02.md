---
title: 'Testing React-hook defensive branches: assert behavior, not the React-19 unmount warning, and freeze the clock so ''fires'' uniquely proves the branch'
track: knowledge
category: conventions
module: client
severity: low
tags: [testing, vitest, hooks, react-19, renderHook, fake-timers]
applies_to: [client/**/hooks/**/__tests__/**/*.ts, client/camera/hooks/__tests__/*.test.ts]
created: '2026-06-02'
last_updated: '2026-06-02'
---

## Rule

When you add a real-SUT test (`renderHook` from `@testing-library/react`, not an
inline re-implementation) for a hook's **defensive branch**, make the
**observable behavior** the load-bearing assertion — and design the inputs so
that behavior diverges only when the branch under test actually runs.

Two specific traps this codifies:

1. **A post-unmount / `isActiveRef`-style guard cannot be verified by asserting
   the absence of a "setState on an unmounted component" warning.** React 18
   removed that warning; under React 19 it never fires. A `console.error` spy
   asserting `not.toHaveBeenCalled()` therefore passes _vacuously_ — delete the
   guard and the test still goes green. The assertion that actually catches the
   regression is **callback-not-called**: capture the handler before `unmount()`
   (refs are stable, so the captured closure sees the same internal ref the
   cleanup effect flips), call it after unmount, and assert the downstream
   callback did **not** fire. No `act()` wrapper — the guard early-returns before
   any setState, so nothing is queued.

2. **For a "this entry was evicted / cleared" assertion, freeze the clock and
   assert `isRepeat === false`, not merely "callback fired".** With
   `vi.useFakeTimers()` and no `advanceTimersByTime` between the setup scans and
   the re-scan, every scan shares the same `now`. If the entry still existed, the
   re-scan would be inside the debounce window (`now - lastTime = 0 < debounceMs`)
   and would be silently ignored. So under a frozen clock, the re-scan firing
   **at all** — and firing with `isRepeat=false` (a fresh insert, not a stale
   repeat) — uniquely proves the entry was gone. Asserting
   `toHaveBeenLastCalledWith({...}, false)` plus the exact call count is the
   discriminating signal; advancing the clock would let a non-evicted entry fire
   with `isRepeat=true` and muddy the proof.

## When this applies

- Adding tests for defensive branches in `useCamera` or any similar hook that
  uses an internal "mounted/active" ref guard and/or a Map/Set with a size cap or
  reset.
- Any test tempted to assert on a React unmount/`setState`-after-unmount warning.

## Why

A test whose assertion passes whether or not the production branch ran gives
false CI confidence (the same failure mode the project's testing rules call out
for inline-reimplemented predicates). The React-19 warning removal is the
non-obvious part: the "obvious" assertion (no warning) is exactly the one that no
longer works. Tying the assertion to a behavioral divergence that only the branch
can produce keeps the test honest.

## Examples

Post-unmount guard (`useCamera.ts:76`, `if (!isActiveRef.current) return`):

```ts
const { result, unmount } = renderHook(() =>
  useCamera({ onBarcodeScanned, batch: true }),
);
const handler = result.current.handleBarcodeScanned; // capture BEFORE unmount
unmount();
handler({ data: "1234567890123", type: "ean13" }); // no act() — guard early-returns
expect(onBarcodeScanned).not.toHaveBeenCalled(); // load-bearing
```

Size-cap eviction (`useCamera.ts:87-97`, oldest key evicted at cap 200):

```ts
act(() => {
  for (let i = 0; i < 201; i++) {
    result.current.handleBarcodeScanned({ data: `barcode-${i}`, type: "ean13" });
  }
});
// Re-scan the first barcode with the clock STILL frozen.
act(() => {
  result.current.handleBarcodeScanned({ data: "barcode-0", type: "ean13" });
});
expect(onBarcodeScanned).toHaveBeenCalledTimes(202);
expect(onBarcodeScanned).toHaveBeenLastCalledWith(
  { data: "barcode-0", type: "ean13" },
  false, // isRepeat=false proves the entry was evicted, not debounced
);
```

## Related Files

- `client/camera/hooks/useCamera.ts` — hook with the two defensive branches
- `client/camera/hooks/__tests__/useCamera.test.ts` — the real-SUT tests

## See Also

- `docs/solutions/design-patterns/mounted-ref-guard-async-hooks-2026-05-13.md` — the production-side mounted-ref guard pattern
- `docs/solutions/logic-errors/react-19-finally-block-batches-setstate-2026-05-13.md` — related React-19 setState-batching behavior
- `docs/rules/testing.md` — never re-implement the logic under test inline
