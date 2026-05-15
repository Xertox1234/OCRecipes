---
title: "useCallback for hook-returned components remounts on every state change"
track: bug
category: logic-errors
tags: [react, hooks, useCallback, useMemo, component-identity, bottom-sheet]
module: client
applies_to:
  ["client/hooks/useConfirmationModal.ts", "client/hooks/use*Modal.ts"]
symptoms:
  - "BottomSheetModal dismisses itself immediately after presenting"
  - "Hook-returned component loses internal state between renders"
  - "Modal animation flickers because the component instance is replaced each render"
created: 2026-03-25
severity: high
---

# useCallback for hook-returned components remounts on every state change

## Problem

`useConfirmationModal()` returned a `ConfirmationModal` component built with `useCallback`. When the callback depended on `options` state (which changed on every `confirm()` call), React received a new component **type** on each call. React uses function identity to decide whether a component type changed — a new reference unmounts the old instance and mounts a new one, destroying `BottomSheetModal`'s presented state.

## Symptoms

- Modal flashes open and closes immediately on `confirm()`
- Internal state in the returned component resets unexpectedly
- React DevTools shows the component "remounting" instead of "re-rendering"

## Root Cause

`useCallback(fn, deps)` returns a new function reference whenever `deps` change. For ordinary callbacks this is harmless; for a callback that **is itself a component**, the new reference is treated as a new component type. React then unmounts the previous tree.

```tsx
// Bad — useCallback: new identity on every options change → remount
const ConfirmationModal = useCallback(() => {
  return <ConfirmationModalInner options={options} />;
}, [options]); // options changes every confirm() → new component identity
```

## Solution

Use `useMemo` with a minimal dependency array. Store changing data in a ref and signal updates with a counter:

```tsx
// Good — useMemo: stable identity, ref for changing data
const optionsRef = useRef(options);
const [revision, bumpRevision] = useReducer((x) => x + 1, 0);

const ConfirmationModal = useMemo(
  () =>
    function StableConfirmationModal() {
      return (
        <ConfirmationModalInner optionsRef={optionsRef} revision={revision} />
      );
    },
  [revision],
);
```

## Prevention

- When a hook returns a component, minimize the `useMemo` dependency array. Refs for changing data + counter for signalling are the canonical pattern.
- Use a named function expression (`function StableModal() {}`) inside `useMemo` for clearer React DevTools names.
- If you find yourself wrapping a component in `useCallback`, reach for `useMemo` instead.

## Related Files

- `client/hooks/useConfirmationModal.ts`
- `docs/patterns/hooks.md` — "Hook-Returned Component Pattern for BottomSheetModal"

## See Also

- [React: useMemo](https://react.dev/reference/react/useMemo)
- [React: useCallback](https://react.dev/reference/react/useCallback)
