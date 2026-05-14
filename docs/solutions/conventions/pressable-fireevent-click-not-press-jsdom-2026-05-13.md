---
title: "Pressable `fireEvent` in JSDOM: use `click`, not `press`"
track: knowledge
category: conventions
tags: [testing, vitest, react-native, jsdom, testing-library, pressable]
module: client
applies_to: ["client/components/**/__tests__/**/*.test.tsx"]
created: 2026-05-13
---

# Pressable `fireEvent` in JSDOM: use `click`, not `press`

## Rule

When testing React Native `Pressable` components with `@testing-library/react` in a JSDOM Vitest environment, use `fireEvent.click`, **not** `fireEvent.press`.

## Examples

```tsx
// ❌ WRONG — fireEvent.press is silently ignored in the RN/JSDOM mock
fireEvent.press(getByLabelText("Dismiss"));
expect(onDismiss).toHaveBeenCalledTimes(1); // fails: 0

// ✅ CORRECT
fireEvent.click(getByLabelText("Dismiss"));
expect(onDismiss).toHaveBeenCalledTimes(1); // passes
```

## Why

The RN test environment maps `onPress` → DOM `onClick`. `fireEvent.press` dispatches a synthetic press event that the mock doesn't handle, silently doing nothing, so assertions on calls to `onPress` pass zero instead of one.

## Scope

Only applies to components tested with `@testing-library/react` under `// @vitest-environment jsdom`. Tests for extracted pure functions (no RN imports) are unaffected.

## Related Files

- `client/components/home/__tests__/DiscoveryCard.test.tsx`

## See Also

- [`@vitest-environment jsdom` pragma required for component tests](../best-practices/jsdom-pragma-required-for-component-tests-2026-05-13.md)
