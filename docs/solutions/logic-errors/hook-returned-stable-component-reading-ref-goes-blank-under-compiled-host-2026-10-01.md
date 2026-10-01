---
title: "A hook-returned stable component that reads a ref during render goes blank inside a host compiled by React Compiler"
track: bug
category: logic-errors
tags: [react-native, hooks, react-compiler, memoization, refs, bottom-sheet, client-state]
module: client
applies_to: [client/components/**/*.tsx, client/hooks/**/*.ts, client/screens/**/*.tsx]
symptoms: ["A confirm/bottom sheet opens with an empty title and message and generic button labels on some screens but not others", "The sheet's buttons still work (they read fresh data at tap time) while the text it draws is stale or empty", "Unit tests pass but the device shows stale content, only on screens the compiler compiles"]
created: '2026-10-01'
severity: high
---

# A hook-returned stable component that reads a ref during render goes blank inside a host compiled by React Compiler

## Symptom

`useConfirmationModal()` showed a blank delete sheet: no title, no message, and a generic "Cancel / Confirm" instead of a red "Delete". This happened on Grocery Lists, Pantry, Saved items and the Coach chat list. Settings → Sign Out, using the same hook, rendered correctly. Confirm still deleted, because the tap handler reads `optionsRef.current` at tap time. The bug shipped in both the production and preview OTA lanes.

## Root cause

The hook used a common "hook returns a component" shape:

- `confirm(opts)` wrote `optionsRef.current = opts`, then forced a host re-render with `setRevision(r => r + 1)`.
- The hook returned `ConfirmationModal = useMemo(() => function Stable() { return <Inner optionsRef={optionsRef} … /> }, [handleClosed])`. Its identity never changes, so the sheet never remounts.
- `Inner` read `const options = optionsRef.current` **during render** to draw the text.

This works only if every host re-render also re-renders `Inner`. An uncompiled host builds a fresh `<ConfirmationModal />` element each render, so React re-renders it. A host compiled by React Compiler caches that element on its only dependency, the never-changing component:

```js
if ($[91] !== ConfirmationModal) { t28 = <ConfirmationModal />; $[91] = ConfirmationModal; $[92] = t28; }
else { t28 = $[92]; }
```

React sees the same element object and skips the subtree. `Inner` keeps its first render, from before any `confirm()`, when options were `null`. So whether the sheet works depends on whether the **host** compiles. The hook was skipped by the compiler, so its own file looked fine. Vitest uses esbuild with no compiler, so every existing test passed.

## Fix

Draw from state the child owns, and push new data into that state directly:

- `Inner` holds `const [options, setOptions] = useState(null)`.
- `Inner` registers `setOptions` into a hook-owned `optionsSetterRef` in an effect. It catches up from `optionsRef.current` on mount and clears the ref on unmount.
- `confirm()` calls `optionsSetterRef.current?.(opts)` instead of forcing a host re-render.
- Tap handlers keep reading `optionsRef.current` at tap time. That is fine: it's a read in a callback, not during render.

Afterwards the hook file compiles too (2 functions, 0 errors), and its entry leaves `scripts/react-compiler-bailout-baseline.json`.

## How it was found and proven

- `babel-plugin-react-compiler` run over each skipped file, with a logger, showed `ConfirmationModal.tsx` bailing on `Refs` and `PreserveManualMemo`. Compiling a **host** (`ChatListScreen.tsx`) and reading the output showed the cached element above.
- **Simulator, with a control:** Grocery Lists, a compiled host, showed the blank sheet. Settings, a host the compiler skips, showed the correct sheet. Same hook; the only difference is whether the host compiles.
- **Test that reproduces the compiler without running it:** a host harness wrapping the element in `useMemo(() => <ConfirmationModal />, [ConfirmationModal])`. It failed on the old code while the file's uncached tests still passed. See `client/components/__tests__/ConfirmationModal.test.tsx` → "inside a host that caches the element".

## Rule

A component returned from a hook with a stable identity must get what it **draws** from its own state, or from a subscription it owns. It must never get it from a ref read during render that relies on a parent re-render. Any compiled parent caches the element and the child freezes.

Check for this shape whenever a compiler fix makes a **host** start compiling. Fixing the hook alone is not enough to be safe: the hook must be fixed first, or every host that starts compiling inherits the bug.

`useBeverageSheet` has the same hook shape and is safe. Its sheet reads the ref only inside the log tap handler, never during render.
