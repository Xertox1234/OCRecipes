---
title: "React Compiler skips a component that reads `field.ref` off a hook's returned object in render — destructure `ref` first"
track: bug
category: code-quality
tags: [react-native, hooks, performance, typescript]
module: client
applies_to: ["client/screens/**/*.tsx", "client/components/**/*.tsx", "client/hooks/**/*.ts"]
symptoms: ["`node scripts/check-react-compiler-bailouts.js` reports new bailouts for screens that adopted `useFieldValidation` (7 at once in the form-fields Task 8 branch)", "Vitest, tsc and ESLint are all green; only the ratchet notices"]
created: 2026-10-26
severity: medium
---

# React Compiler skips a component that reads `field.ref` off a hook's returned object in render — destructure `ref` first

## Problem

`useFieldValidation` returns an object per field: `{ ref, error, onBlur, … }`. The screens wrote `<TextInput ref={field.ref} … />`. Because that reads a ref off the object during render, React Compiler treated the **whole object** as a ref. It then refused to compile the component, and the screen silently ran unmemoized.

## Symptoms

- The bailout ratchet flags every screen that uses the hook. Nothing else does: tests, types and lint all pass.
- The same skip happens for an object of `useRef`s that is read in render, for example `fieldRefs.age`.

## Root Cause

The compiler infers "ref-ness" by object. Once render reads `.ref` (or `.current`) from a value, every other property of that value is suspect too. Reading `field.error` in the same render is then a possible ref read during render, which the compiler refuses to compile.

## Solution

Destructure the ref out of the object, and use the plain names in JSX:

```tsx
const { ref: ageRef, error: ageError, onBlur: ageOnBlur } = age; // age = useFieldValidation(...).fields.age
<TextInput ref={ageRef} error={!!ageError} onBlur={ageOnBlur} />
```

For an object of refs, use separate `useRef` calls (`const ageRef = useRef(null)`), not `useRef({ age: null, … })` read as `refs.current.age`.

## Prevention

- Run `node scripts/check-react-compiler-bailouts.js` after adopting any hook that returns refs inside an object.
- `useFieldValidation`'s doc comment states this rule.

## Related Files

- `client/hooks/useFieldValidation.ts`
- `scripts/check-react-compiler-bailouts.js`

## See Also

- [react-compiler-bails-on-try-finally-inside-a-hook-callback](react-compiler-bails-on-try-finally-inside-a-hook-callback-2026-10-18.md) — another bailout only the ratchet catches
- [hook-returned stable component reading a ref](../logic-errors/hook-returned-stable-component-reading-ref-goes-blank-under-compiled-host-2026-10-01.md) — a ref read in render that renders blank instead of bailing
