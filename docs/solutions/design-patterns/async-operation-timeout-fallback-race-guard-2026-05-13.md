---
title: "Async operation with timeout fallback + race condition guard"
track: knowledge
category: design-patterns
tags: [react-native, async, timeout, race-condition, useref]
module: client
applies_to: ["client/screens/**/*.tsx", "client/hooks/**/*.ts"]
created: 2026-05-13
---

# Async operation with timeout fallback + race condition guard

## When this applies

When an async operation (API call) has a timeout fallback (navigate away), guard against the API response arriving after the timeout fires.

## Examples

```typescript
const isProcessingRef = useRef(false);
const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

const handleAsyncWithFallback = async (data: string) => {
  if (isProcessingRef.current) return; // Prevent duplicate calls
  isProcessingRef.current = true;

  // Timeout → fallback navigation
  timeoutRef.current = setTimeout(() => {
    isProcessingRef.current = false;
    navigation.navigate("Fallback");
  }, 10000);

  try {
    const result = await apiCall(data);

    // Clear timeout (no-op if already fired)
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    // CRITICAL: bail out if timeout already fired and navigated
    if (!isProcessingRef.current) return;

    // ... handle result (navigate, set state)
  } catch {
    isProcessingRef.current = false;
    navigation.navigate("Fallback");
  }
};
```

## Why

**Key details:**

- `useRef` (not `useState`) for the guard — synchronous reads, no re-render needed
- `clearTimeout` on an already-fired timer is a no-op — it does NOT tell you the timer ran
- The `if (!isProcessingRef.current) return` guard is the critical line that prevents double navigation
- Always clean up timeout refs in a `useEffect` cleanup function

Without the guard, if the API responds after the 10s timeout, both the timeout handler AND the success handler navigate — causing a double navigation crash or confusing UX.

## Related Files

- `client/screens/ScanScreen.tsx` — `handleSmartScan()` with classification timeout fallback
- Bug found and fixed during PR #14 code review

## See Also

- [Async mutation double-tap guard](async-mutation-double-tap-guard-2026-05-13.md)
- [Use useRef for synchronous checks in callbacks](../conventions/useref-for-synchronous-checks-in-callbacks-2026-05-13.md)
