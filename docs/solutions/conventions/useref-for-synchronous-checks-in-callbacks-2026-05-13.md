---
title: Use useRef for synchronous checks in callbacks (dual tracking)
track: knowledge
category: conventions
module: client
tags: [react, hooks, useref, usecallback, stale-closure, debouncing]
applies_to: [client/hooks/**/*.ts, client/screens/**/*.tsx, client/components/**/*.tsx]
created: '2026-05-13'
---

# Use useRef for synchronous checks in callbacks (dual tracking)

## Rule

When a callback needs to check mutable state synchronously (e.g., debouncing, rate limiting), use `useRef` instead of state. State values captured in closures become stale. Keep both `useState` (for UI rendering) and `useRef` (for synchronous logic) when you need both reactive UI updates and reliable synchronous checks.

## Examples

```typescript
// Good: useRef for synchronous checks
export function useCamera() {
  const [isScanning, setIsScanning] = useState(false);
  const isScanningRef = useRef(false);
  const debounceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleBarcodeScanned = useCallback((barcode: string) => {
    // Use ref for synchronous check - always has current value
    if (isScanningRef.current) return;

    isScanningRef.current = true;
    setIsScanning(true);

    // Process barcode...

    // Debounce: reset after delay
    debounceTimeoutRef.current = setTimeout(() => {
      isScanningRef.current = false;
      setIsScanning(false);
    }, 2000);
  }, []); // Empty deps - refs don't need to be dependencies

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, []);

  return { isScanning, handleBarcodeScanned };
}
```

```typescript
// Bad: State check in callback - always stale!
export function useCamera() {
  const [isScanning, setIsScanning] = useState(false);

  const handleBarcodeScanned = useCallback(
    (barcode: string) => {
      // BUG: isScanning is captured at callback creation time
      // It will always be the initial value (false)
      if (isScanning) return; // This never blocks!

      setIsScanning(true);
      // Process barcode... but rapid scans all get through
    },
    [isScanning],
  ); // Adding dependency recreates callback but doesn't fix the issue
}
```

## Why

`useCallback` creates a closure that captures state values at creation time. Even with dependencies, the check happens against a potentially outdated snapshot. `useRef.current` is a mutable property — reading it inside a callback always sees the latest value.

## Exceptions

When to use:

- Debouncing rapid events (barcode scans, button clicks)
- Rate limiting (API calls, animations)
- Any callback that needs to check "am I already processing?"

When NOT to use:

- Values whose changes must trigger re-renders — those still need `useState`
- Server-state caching — let TanStack Query handle that

## Related Files

- `client/camera/hooks/useCamera.ts` — `isScanningRef` debounce
- `client/components/meal-plan/QuickAddSheet.tsx` — `isAdding` ref guard

## See Also

- [Stale Closure in React Callbacks - Use Refs for Synchronous Checks](../logic-errors/stale-closure-callback-refs.md) (the bug-track post-mortem)
- [Async mutation double-tap guard](../design-patterns/async-mutation-double-tap-guard-2026-05-13.md)
- [Async operation with timeout fallback + race condition guard](../design-patterns/async-operation-timeout-fallback-race-guard-2026-05-13.md)
