---
title: React 19 `useRef` Requires an Explicit Initial Value
track: bug
category: code-quality
module: client
severity: medium
tags: [react, react-19, useRef, typescript, upgrade]
symptoms: ['TS error: `Argument of type ''undefined'' is not assignable to parameter of type ...`', '`useRef<T>()` with no argument breaks the build after upgrading to React 19', Timer refs that worked under React 18 fail to compile]
applies_to: [client/**/*.ts, client/**/*.tsx]
created: '2026-05-13'
---

# React 19 `useRef` Requires an Explicit Initial Value

## Problem

In React 19, `useRef<T>()` without an initial value argument causes a TypeScript error. This broke during the Phase 4 snackbar timer implementation.

```typescript
// React 18: works fine
const timerRef = useRef<ReturnType<typeof setTimeout>>();

// React 19: TS error — Argument of type 'undefined' is not assignable
// Fix: pass undefined explicitly
const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
```

## Symptoms

- TypeScript compile error on every `useRef<T>()` call missing an initial value.
- Error message references the new stricter no-argument overload.
- The bug surfaces only after upgrading the `@types/react` package to v19; runtime behavior is unaffected.

## Root Cause

React 19 tightened the `useRef` type signatures. Under React 18, `useRef<T>()` with no argument resolved to a `MutableRefObject<T | undefined>`. Under React 19, the no-argument overload was removed, and callers must pass either `undefined` (mutable, may be reassigned) or `null` (typical for DOM/component refs) depending on intent.

## Solution

Pass an explicit initial value matching the intended ref shape:

```typescript
// ✅ Mutable timer ref — undefined initial, will hold a timeout handle
const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

useEffect(() => {
  timerRef.current = setTimeout(() => setVisible(false), 3000);
  return () => clearTimeout(timerRef.current);
}, []);

// ✅ DOM / component ref — null initial, set by React via the `ref` prop
const inputRef = useRef<TextInput>(null);
```

For timer refs specifically, `undefined` is correct because `clearTimeout(undefined)` is a safe no-op — the cleanup function doesn't need a guard. `null` is the convention for refs assigned via the JSX `ref={}` prop (React writes the node into `.current`).

## Prevention

- When starting a project on React 19 or upgrading from 18, codemod or grep for `useRef<` immediately followed by `>()` and add an explicit initial value.
- Choose the initial value based on use:
  - Timer / interval handles: `undefined`.
  - DOM nodes / component instances: `null`.
  - Mutable scalar (e.g., a flag): the actual initial value (`false`, `0`, etc.).
- Lint rule candidate: forbid the no-argument `useRef` call in TS files.

## Related Files

- `client/components/Snackbar.tsx` — timer ref, fixed during Phase 4
- `client/camera/hooks/useCamera.ts` — `isScanningRef` uses explicit `useRef(false)`

## See Also

- [../logic-errors/stale-closure-callback-refs.md](../logic-errors/stale-closure-callback-refs.md) — When `useRef` is the right tool for synchronous state checks inside callbacks.
- React 19 release notes — `useRef` type signature changes
