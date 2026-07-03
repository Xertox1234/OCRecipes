---
title: Capture inner setTimeout handles in outer useEffect closures
track: knowledge
category: conventions
module: client
tags: [react, useeffect, settimeout, cleanup, closures]
applies_to: [client/components/**/*.tsx, client/screens/**/*.tsx, client/hooks/**/*.ts]
created: '2026-05-13'
---

# Capture inner setTimeout handles in outer useEffect closures

## Rule

A `useEffect` that schedules a timer, then schedules a _nested_ timer inside the first callback, must capture both handles via closure variables so the cleanup function can clear both. The cleanup only sees the variables captured at effect-setup time.

## Examples

```typescript
// Bad: inner setTimeout's handle is never captured
useEffect(() => {
  const outer = setTimeout(() => {
    animate.value = withSequence(withTiming(1), withTiming(0));
    setTimeout(() => onComplete?.(), 300); // fires on unmounted component!
  }, 300);
  return () => clearTimeout(outer); // only clears the outer timer
}, [visible]);
```

```typescript
// Good: inner timer captured in the outer effect's closure
useEffect(() => {
  let completeTimer: ReturnType<typeof setTimeout> | undefined;
  const outer = setTimeout(() => {
    animate.value = withSequence(withTiming(1), withTiming(0));
    completeTimer = setTimeout(() => onComplete?.(), 300);
  }, 300);
  return () => {
    clearTimeout(outer);
    if (completeTimer) clearTimeout(completeTimer);
  };
}, [visible]);
```

## Why

The cleanup runs when the effect re-runs or on unmount. The inner `setTimeout` may not have been scheduled yet at cleanup time, OR it may have already fired. By keeping a closure variable, the cleanup function conditionally clears whichever timer is still pending.

## Exceptions

When to apply: any effect that schedules chained timers (staggered animations, fade-in-then-out-then-complete sequences, debounced state-then-side-effect patterns).

## Related Files

- 2026-04-17 audit H15 — `AnimatedCheckmark.tsx` scheduled the fade-out `setTimeout` from within the draw-complete `setTimeout`. Cleanup cleared only the outer handle; the inner callback fired after unmount, risking `setState`-on-unmounted warnings and triggering `onComplete` after the consumer had already moved on.

## See Also

- [Async operation with timeout fallback + race condition guard](../design-patterns/async-operation-timeout-fallback-race-guard-2026-05-13.md)
