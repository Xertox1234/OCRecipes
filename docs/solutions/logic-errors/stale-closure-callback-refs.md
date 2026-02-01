---
title: "Stale Closure in React Callbacks - Use Refs for Synchronous Checks"
category: logic-errors
tags: [react, hooks, useCallback, useRef, stale-closure, debouncing]
module: camera
symptoms:
  - Duplicate barcode scans despite debounce implementation
  - Callback checks always see outdated state value
  - Debounce logic appears to not work
created: 2026-02-01
severity: high
---

# Stale Closure in React Callbacks

## Problem

The `useCamera` hook's `handleBarcodeScanned` callback was triggering multiple times for the same barcode despite having a debounce check. The `isScanning` state flag was always `false` inside the callback, even after being set to `true`.

## Symptoms

- Barcode scans triggered 2-5x per scan instead of once
- Console logs showed `isScanning` always `false`
- Adding `isScanning` to dependency array caused infinite re-renders

## Root Cause

**Stale closure**: When a callback is memoized with `useCallback`, it "closes over" the state values at the time the function was created. If the callback doesn't re-create when state changes, it sees stale values.

```typescript
// BEFORE (buggy - stale closure)
const [isScanning, setIsScanning] = useState(false);

const handleBarcodeScanned = useCallback(
  (result: BarcodeResult) => {
    // This check ALWAYS sees isScanning as false (stale value)
    if (isScanning) return;

    setIsScanning(true); // State updates, but callback still has old value
    onBarcodeScanned(result);

    setTimeout(() => setIsScanning(false), 2000);
  },
  [onBarcodeScanned],
); // isScanning not in deps = stale closure
```

The issue: `isScanning` in the callback refers to the value when the function was created, not the current value.

## Solution

Use `useRef` instead of `useState` for values that need to be checked synchronously inside callbacks. Refs are mutable and always provide the current value.

```typescript
// AFTER (fixed - ref always current)
const isScanningRef = useRef(false);
const [isScanning, setIsScanning] = useState(false); // Keep for UI if needed

const handleBarcodeScanned = useCallback(
  (result: BarcodeResult) => {
    // Ref check ALWAYS sees current value
    if (isScanningRef.current) return;

    isScanningRef.current = true;
    setIsScanning(true); // For UI updates

    onBarcodeScanned(result);

    setTimeout(() => {
      isScanningRef.current = false;
      setIsScanning(false);
    }, 2000);
  },
  [onBarcodeScanned],
); // No need to include ref in deps
```

## Why This Works

| Approach   | Behavior                               | Use Case                                                |
| ---------- | -------------------------------------- | ------------------------------------------------------- |
| `useState` | Returns stable value from render time  | Triggering re-renders, displaying in UI                 |
| `useRef`   | Returns mutable object with `.current` | Synchronous checks in callbacks, storing mutable values |

Refs don't trigger re-renders when changed, and the `.current` property always reflects the latest value because it's a mutable object reference.

## Prevention

1. **Pattern**: For flags checked inside callbacks, use refs
2. **Pattern**: For values displayed in UI, use state
3. **Pattern**: Often you need both - ref for logic, state for UI
4. **Test**: Unit tests should verify debouncing works (see `useCamera.test.ts`)

```typescript
// Pattern: Dual tracking
const isScanningRef = useRef(false); // For callback logic
const [isScanning, setIsScanning] = useState(false); // For UI spinner

const handleAction = useCallback(() => {
  if (isScanningRef.current) return; // Synchronous check with ref
  isScanningRef.current = true;
  setIsScanning(true); // Update UI
  // ... rest of logic
}, []);
```

## Related Files

- `client/camera/hooks/useCamera.ts:56-58` - Fixed implementation
- `client/camera/hooks/__tests__/useCamera.test.ts` - Unit tests for debouncing
- `docs/PATTERNS.md` - General React patterns

## See Also

- [React docs: useRef](https://react.dev/reference/react/useRef)
- [Dan Abramov: A Complete Guide to useEffect](https://overreacted.io/a-complete-guide-to-useeffect/)
