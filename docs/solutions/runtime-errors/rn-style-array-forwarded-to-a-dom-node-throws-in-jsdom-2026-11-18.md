---
title: "A React Native style array forwarded to a DOM node throws in jsdom 31 — test mocks must flatten style first"
track: bug
category: runtime-errors
tags: [testing, typescript, react-native, jsdom, mocks, dependencies]
module: client
applies_to: [test/mocks/**/*.ts, test/mocks/**/*.tsx, client/**/__tests__/**/*.tsx]
symptoms: ["TypeError: 'set' on proxy: trap returned falsish for property '0'", "A component test fails only when the component passes `style={[a, b]}` to a mocked native component", "Tests that passed on an older jsdom fail after a jsdom bump with no source change"]
severity: medium
created: '2026-11-18'
---

# A React Native style array forwarded to a DOM node throws in jsdom 31 — test mocks must flatten style first

## Problem

Component tests render React Native components through mocks in `test/mocks/`
that map them to DOM elements. React Native accepts a style **array**, nested
to any depth (`style={[styles.base, pressed && styles.pressed, [extra]]}`).
A mock that passes `style` straight through hands that array to react-dom,
which writes its keys (`0`, `1`, …) onto the element's `style` declaration.

The jsdom this repo used before ignored those writes. jsdom 31 rejects them, and every test
whose tree contains an array style fails.

## Symptoms

- `TypeError: 'set' on proxy: trap returned falsish for property '0'`
- The stack points into react-dom's style handling, not into app code.

## Root Cause

The mocks were wrong all along: a DOM node's `style` takes an object. The old
jsdom tolerated the mistake silently, so nothing forced the mocks to honour
React Native's style contract.

## Solution

`test/mocks/react-native.ts` exports `flattenStyle`, and every mock that
forwards `style` to a DOM element calls it (#1919):

```ts
export function flattenStyle(style: unknown): Record<string, unknown> | undefined {
  if (!style) return undefined;
  if (!Array.isArray(style)) return style as Record<string, unknown>;
  const merged: Record<string, unknown> = {};
  for (const entry of style) Object.assign(merged, flattenStyle(entry));
  return merged;
}
```

```ts
// in a mock component
return React.createElement("div", { ref, ...rest, style: flattenStyle(rest.style) });
```

Two details:

- A non-array style is returned as the **same object**. The mocked
  `StyleSheet.flatten` uses this helper, and components that destructure its
  result rely on getting their own object back.
- Falsy entries (`false`, `null`, `undefined`) are skipped, as in React Native.

## Prevention

- A new mock in `test/mocks/` that renders a DOM element must pass
  `style: flattenStyle(rest.style)`, never `rest.style`.
- `test/mocks/__tests__/style-arrays.test.tsx` renders each mocked component
  with a nested style array. Add a row there for every new mock.

## Related Files

- `test/mocks/react-native.ts` — `flattenStyle`, `StyleSheet.flatten`
- `test/mocks/__tests__/style-arrays.test.tsx`
- `test/mocks/{react-native-reanimated,expo-image,expo-linear-gradient,expo-blur,expo-vector-icons,gorhom-bottom-sheet,react-native-svg,react-native-screens}.ts`

## See Also

- [wrapper style appended after caller overrides](../logic-errors/wrapper-style-appended-after-caller-overrides-larger-caller-value-2026-10-26.md) — style-array ordering in app code
