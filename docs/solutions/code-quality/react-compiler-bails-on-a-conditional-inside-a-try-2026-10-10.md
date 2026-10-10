---
title: "React Compiler bails on a ternary, && or ?. inside a try block — compute the condition before the try"
track: bug
category: code-quality
tags: [react-native, hooks, performance, typescript]
module: client
applies_to: ["client/screens/**/*.tsx", "client/components/**/*.tsx"]
symptoms: ["`node scripts/check-react-compiler-bailouts.js` reports N new bailouts for components that have no try/finally", "Every flagged component has an async handler with a ternary, `&&`/`||` or optional chain inside its `try { }`"]
created: 2026-10-10
severity: medium
---

# React Compiler bails on a ternary, && or ?. inside a try block — compute the condition before the try

## Problem

Two-step verification (#1357) added five components whose submit handlers looked like this:

```ts
try {
  const result = await onConfirm(email, password, needsCode && factor ? factor : undefined);
```

The bailout ratchet reported **5 new bailouts**. None of the files used `try/finally`, which is the bailout the repo already documents.

## Symptoms

- The ratchet names files that have no `finally`.
- Unit tests and tsc pass. Vitest doesn't run the compiler, so nothing else notices.

## Root Cause

React Compiler can't lower a **value block** inside a `try` statement. A value block is any expression that branches: a ternary, `&&`/`||`/`??`, or `?.`. When it meets one, it skips the whole component (it doesn't throw), and every manual memo the component relies on becomes load-bearing again. This sits next to the known `finally` limit ("React Compiler cannot lower a `finally`"), but it's a separate trigger.

## Solution

Compute the condition **before** the `try`, and inside it use only plain statements: `if (x)` on an identifier, or `if (a === b)`.

```ts
// Outside the try: React Compiler can't lower a conditional inside one.
const proof = needsCode && factor ? factor : undefined;
try {
  const result = await onConfirm(email, password, proof);
```

For a branch chain, use nested `if`s on a single identifier (`else if (factor) { if (mode === "x") … }`), not `else if (mode === "x" && factor)`. With these changes the ratchet went from 5 new bailouts to 0 (#1357, commit `57b4649f`).

## Prevention

Run `node scripts/check-react-compiler-bailouts.js` after writing an async handler with a `try`. CI's lint step runs it too, but finding out locally saves a push.

## Related Files

- `client/screens/TwoStepSetupScreen.tsx`, `client/screens/SignInMethodsScreen.tsx`, `client/screens/TwoStepCodeScreen.tsx`, `client/components/ChangeEmailModal.tsx`, `client/components/DeleteAccountModal.tsx`
- `scripts/check-react-compiler-bailouts.js`

## See Also

- [React Compiler memoization audits](../best-practices/react-compiler-memoization-audits-2026-06-10.md) — coverage is per file and must be checked
- [React Compiler discards an unread useMemo dependency](../conventions/react-compiler-discards-unread-usememo-dependency-2026-09-02.md) — names `try/finally` as a known bailout
