---
title: "Memory Leak from Missing useEffect Cleanup"
category: logic-errors
tags: [react, hooks, useEffect, memory-leak, cleanup, timers]
module: camera
symptoms:
  - "Warning: Can't perform a React state update on an unmounted component"
  - Memory usage grows over time
  - State updates after navigation away from screen
created: 2026-02-01
severity: high
---

# Memory Leak from Missing useEffect Cleanup

## Problem

The `useCamera` hook set a timeout for debouncing barcode scans but never cleaned up the timeout when the component unmounted. This caused memory leaks and React warnings about state updates on unmounted components.

## Symptoms

- Console warning: "Warning: Can't perform a React state update on an unmounted component"
- App memory usage slowly increasing over time
- State updates firing after user navigated away from camera screen
- Potential crashes in long sessions

## Root Cause

When a component unmounts (user navigates away), any active timers, intervals, or subscriptions continue running. If they try to update state, React throws warnings and the callbacks may reference stale component state.

```typescript
// BEFORE (memory leak)
const handleBarcodeScanned = useCallback((result: BarcodeResult) => {
  // ...
  scanTimeoutRef.current = setTimeout(() => {
    isScanningRef.current = false;
    setIsScanning(false); // Runs even after unmount!
  }, 2000);
}, []);

// No cleanup - timeout persists after unmount
```

## Solution

Add a cleanup function in `useEffect` that clears the timeout when the component unmounts.

```typescript
// AFTER (fixed - cleanup on unmount)
const scanTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

// Cleanup timeout on unmount
useEffect(() => {
  return () => {
    if (scanTimeoutRef.current) {
      clearTimeout(scanTimeoutRef.current);
    }
  };
}, []);

const handleBarcodeScanned = useCallback((result: BarcodeResult) => {
  // Clear any existing timeout first
  if (scanTimeoutRef.current) {
    clearTimeout(scanTimeoutRef.current);
  }

  // ... scanning logic

  scanTimeoutRef.current = setTimeout(() => {
    isScanningRef.current = false;
    setIsScanning(false);
  }, 2000);
}, []);
```

## The Cleanup Pattern

```typescript
useEffect(() => {
  // Setup phase (runs on mount and updates)
  const timer = setTimeout(() => {
    /* ... */
  }, 1000);
  const subscription = someService.subscribe(() => {
    /* ... */
  });

  // Cleanup phase (runs on unmount and before re-running effect)
  return () => {
    clearTimeout(timer);
    subscription.unsubscribe();
  };
}, [dependencies]);
```

## Common Resources That Need Cleanup

| Resource        | Setup                            | Cleanup                            |
| --------------- | -------------------------------- | ---------------------------------- |
| setTimeout      | `const id = setTimeout(fn, ms)`  | `clearTimeout(id)`                 |
| setInterval     | `const id = setInterval(fn, ms)` | `clearInterval(id)`                |
| Event listeners | `element.addEventListener(...)`  | `element.removeEventListener(...)` |
| Subscriptions   | `service.subscribe(callback)`    | `subscription.unsubscribe()`       |
| WebSocket       | `new WebSocket(url)`             | `socket.close()`                   |
| AbortController | `new AbortController()`          | `controller.abort()`               |
| Animated values | `Animated.timing(...).start()`   | `animation.stop()`                 |

## Prevention

1. **Rule**: Every `setTimeout`/`setInterval` needs a corresponding `clearTimeout`/`clearInterval` in cleanup
2. **Pattern**: Store timer IDs in refs so cleanup can access them
3. **ESLint**: Enable `react-hooks/exhaustive-deps` rule
4. **Testing**: Test that cleanup prevents state updates after unmount

```typescript
// Test pattern for cleanup
it("should cleanup timeout on unmount", () => {
  const clearTimeoutSpy = vi.spyOn(global, "clearTimeout");
  const { unmount } = renderHook(() => useCamera());

  // Trigger a scan that sets a timeout
  act(() => {
    /* trigger scan */
  });

  // Unmount should clear the timeout
  unmount();
  expect(clearTimeoutSpy).toHaveBeenCalled();
});
```

## Related Files

- `client/camera/hooks/useCamera.ts:37-44` - Cleanup implementation
- `client/camera/hooks/__tests__/useCamera.test.ts` - Unit tests
- `docs/PATTERNS.md:816-838` - Cleanup Side Effects pattern
- `docs/LEARNINGS.md:192-214` - useEffect Cleanup lesson

## See Also

- [React docs: Synchronizing with Effects](https://react.dev/learn/synchronizing-with-effects#step-3-add-cleanup-if-needed)
