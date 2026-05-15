---
title: "useEffect Cleanup Must Read Timer Refs at Cleanup Time, Not Setup Time"
track: bug
category: logic-errors
tags: [react, useEffect, useRef, timers, cleanup, exhaustive-deps]
module: client
applies_to:
  ["client/camera/hooks/useScanClassification.ts", "client/**/use*.ts"]
symptoms:
  - "Timer fires after the component unmounts"
  - "Cleanup function clears a captured local variable, not the current `.current`"
  - "`exhaustive-deps` autofix suggested capturing ref in a variable"
created: 2026-04-07
severity: medium
---

# useEffect Cleanup Must Read Timer Refs at Cleanup Time, Not Setup Time

## Problem

`useScanClassification` captured `navigationTimeoutRef.current` and `resetTimeoutRef.current` in local variables at effect setup time, then cleared those variables in the cleanup function. Since the refs were `null` at mount, the timeouts set later during barcode scanning were never cleared on unmount:

```typescript
// Bug: captures null at setup time
useEffect(() => {
  const navTimeout = navigationTimeoutRef.current; // null at mount
  return () => {
    if (navTimeout) clearTimeout(navTimeout); // always clearing null
  };
}, []);
```

## Symptoms

- Navigation triggered by a stale timeout after the user has left the screen
- React warning about state update on unmounted component
- Cleanup function looks correct in isolation but never has a non-null target

## Root Cause

The React hooks lint rule `react-hooks/exhaustive-deps` warns about reading `.current` in cleanup. The original code followed the lint rule's autofix suggestion (capture in a variable at setup) — but that advice is for DOM refs whose `.current` is the same node across the effect's lifetime. Timer refs change asynchronously: the ref is `null` at mount, gets assigned later when a timeout is scheduled, and may change multiple times before unmount. Capturing `.current` at setup snapshots only the mount-time value.

## Solution

Read `.current` directly inside the cleanup function:

```typescript
useEffect(() => {
  return () => {
    if (navigationTimeoutRef.current)
      clearTimeout(navigationTimeoutRef.current);
    if (resetTimeoutRef.current) clearTimeout(resetTimeoutRef.current);
  };
}, []);
```

If `exhaustive-deps` warns, suppress with a comment explaining these are timer IDs, not DOM refs.

## Prevention

- For timer/timeout refs, always read `.current` inside the cleanup function, not at setup time.
- The `exhaustive-deps` capture-in-variable advice is correct for DOM refs (stable across the effect's lifetime) and wrong for refs that hold values assigned asynchronously after mount.
- Document the distinction: any ref that holds a value mutated by `setTimeout` / `setInterval` / async work must be read at cleanup time.

## Related Files

- `client/camera/hooks/useScanClassification.ts` — cleanup now reads `.current` directly
- Audit: 2026-04-07-full-2 finding M13

## See Also

- [Capture inner setTimeout handles in outer effect](../conventions/capture-inner-settimeout-handles-outer-effect-2026-05-13.md)
- [useRef for synchronous checks in callbacks](../conventions/useref-for-synchronous-checks-in-callbacks-2026-05-13.md)
