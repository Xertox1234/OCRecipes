---
title: Ref guard for one-shot effects (fire once per boolean transition)
track: knowledge
category: design-patterns
module: client
tags: [react, hooks, useeffect, useref, transitions]
applies_to: [client/screens/**/*.tsx, client/components/**/*.tsx]
created: '2026-05-13'
last_updated: 2026-11-10
---

# Ref guard for one-shot effects (fire once per boolean transition)

## When this applies

When a `useEffect` should fire a side effect exactly once per boolean transition (e.g., show a toast when an error flag becomes `true`), use a ref to prevent duplicate firings. Without the guard, the effect re-runs whenever any dependency in the array changes — even if the triggering boolean hasn't toggled.

## Examples

```tsx
// client/screens/ChatScreen.tsx — one-shot toast on stream error
const shownStreamErrorRef = useRef(false);

useEffect(() => {
  if (streamError && !shownStreamErrorRef.current) {
    shownStreamErrorRef.current = true;
    toast.error("Response was interrupted.");
  }
  if (!streamError) {
    shownStreamErrorRef.current = false;
  }
}, [streamError, toast]);
```

## Why

React's `useEffect` fires whenever any value in the dependency array changes reference. If `toast` gets a new reference (e.g., context provider re-renders) while `streamError` is still `true`, the effect body runs again — showing a duplicate toast. The ref tracks whether the side effect has already been dispatched for the current `true` cycle and resets when the flag returns to `false`.

## Exceptions

When to use:

- Showing a toast or alert in response to a boolean error/success flag
- Triggering a one-time analytics event when a state condition is met
- Any `useEffect` where a side effect should fire once per `false → true` transition, not on every re-render while the value remains `true`

When NOT to use:

- Effects that should legitimately re-run on every dependency change (e.g., updating derived state)
- Effects gated on values that naturally reset immediately (no window for duplicate fires)

## Related Files

- `client/screens/ChatScreen.tsx` — stream error toast with `shownStreamErrorRef`

## See Also

- [Cross-platform live region announcements](cross-platform-live-region-announcements-2026-05-13.md)
- [Skip-first-render guard for accessibility announcements](../conventions/skip-first-render-guard-accessibility-announcements-2026-05-13.md)

## Variant: render from the latched value when the effect itself clears the flag (2026-11-10)

A guard on the *effect* is not enough when the effect's own side effect flips the
prop the component *renders* from. The weekly report's `HeadlineCard` played its
celebration when `celebrate` was true and called `onCelebrated()`, which marks it
shown and refetches the report — the refetch returns `celebrate: false`, so a
`{celebrate && <Badge/>}` guard unmounted the badge mid-spring. Latch the first
value with `useState(celebrate)` and render and key the effect from the latch
(`client/components/weekly-report/HeadlineCard.tsx`, test
`client/components/weekly-report/__tests__/HeadlineCard.test.tsx`).

