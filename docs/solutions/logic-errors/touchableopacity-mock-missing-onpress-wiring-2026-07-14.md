---
title: Shared TouchableOpacity test mock never wired onPress to onClick
track: bug
category: logic-errors
module: client
severity: high
tags: [testing, react-native, mocks, touchableopacity, vitest]
symptoms: ['A `.click()` on a rendered `TouchableOpacity` in a Vitest/jsdom test does nothing — the `onPress` handler never fires and no assertion about it ever passes', 'The equivalent test written against `Pressable` (same file, same interaction pattern) works correctly', 'Console shows `Unknown event handler property `onPress`` when the mock renders the underlying `<button>`', 'No existing test in the repo click-tests a `TouchableOpacity` — every prior test only asserts on rendered content/props, never interaction']
applies_to: [test/mocks/react-native.ts, client/**/__tests__/*.test.tsx]
created: '2026-07-14'
---

# Shared TouchableOpacity test mock never wired onPress to onClick

## Problem

`test/mocks/react-native.ts` routes most React Native primitives through a
generic `mockComponent(Element, displayName)` helper — including
`TouchableOpacity`, via `mockComponent("button", "TouchableOpacity")`. That
helper renders the underlying DOM element with whatever props it's given
verbatim, which means React Native's `onPress` prop was passed straight
through to a plain `<button>` as `onPress` — a prop the DOM doesn't
recognize and never wires to `onClick`. Every `TouchableOpacity` in every
component test rendered a button that silently did nothing when clicked.

This was completely latent: no test anywhere in the codebase had ever
written a `.click()`-based interaction test against a `TouchableOpacity`,
so nothing had ever failed because of it. It surfaced only when a plan
task required restoring a dropped click-interaction test
(`ProductChip.test.tsx`, "tapping the review card calls onEditStep2") and
the test kept failing with `expected false to be true` no matter how the
component code was written.

## Symptoms

- A new interaction test against a `TouchableOpacity` fails with the
  expected callback never having been called, even though the component
  code and the test's `screen.getByRole("button").click()` call both look
  correct.
- Console warning `Unknown event handler property 'onPress'. It will be
  ignored` printed during the render.
- The identical test pattern against a sibling `Pressable` element in the
  same test file passes.

## Root Cause

`Pressable`'s mock in the same file is a hand-rolled `React.forwardRef`
implementation that explicitly maps `onPress` to the DOM's `onClick`
(`onClick: disabled ? undefined : onPress`). `TouchableOpacity` was routed
through the generic `mockComponent` helper instead, which has no such
mapping — it exists for components that don't need interaction wiring
(`View`, `Text`, `ScrollView`, etc.), and `TouchableOpacity` was added to
that list by pattern-matching "it's a View-like wrapper" rather than "it's
an interaction primitive like `Pressable`."

## Solution

Give `TouchableOpacity` its own `forwardRef` mock that mirrors `Pressable`'s
event-wiring exactly (`onPress` → `onClick`, `disabled` gates both the
handler and the DOM `disabled` attribute, plus the standard
`accessibilityRole`/`accessibilityLabel`/`accessibilityState` → ARIA prop
mapping):

```typescript
export const TouchableOpacity = React.forwardRef<
  unknown,
  Record<string, unknown>
>(({ children, onPress, disabled, testID, accessibilityRole, ...rest }, ref) =>
  React.createElement(
    "button",
    {
      ref,
      onClick: disabled ? undefined : onPress,
      disabled: disabled || undefined,
      "data-testid": testID,
      role: accessibilityRole,
      ...rest,
    },
    children,
  ),
);
TouchableOpacity.displayName = "TouchableOpacity";
```

Scope the fixed mock's props to what's actually used at real call sites in
the codebase (verify via a grep across every `TouchableOpacity` usage)
rather than adding speculative props like `onPressIn`/`onPressOut` that
nothing currently relies on.

## Prevention

- When a shared RN mock file routes a component through a generic
  `mockComponent` helper, check whether that component has an interaction
  prop (`onPress`, `onChange`, `onValueChange`, etc.) before assuming the
  generic helper is sufficient — the helper is correct for pure
  layout/display components and silently wrong for interaction ones.
- Before trusting a component test that renders an interactive element,
  confirm the codebase actually has at least one passing test that clicks
  it and asserts the resulting callback fired. "Renders without crashing"
  is not evidence the interaction wiring works.
- After fixing a shared, globally-aliased test mock, run the full
  client-wide test suite (not just the touched file) as the blast-radius
  check — this exact fix was verified against a 2090-test full sweep
  before being trusted.

## Related Files

- `test/mocks/react-native.ts` — the fixed `TouchableOpacity` mock, and the
  `Pressable` mock it now mirrors
- `client/camera/components/__tests__/ProductChip.test.tsx` — the
  restored click-interaction test that surfaced this gap

## See Also

- [Conditional Pressable rendering — View when no onPress, Pressable when provided](../design-patterns/conditional-pressable-rendering-2026-05-13.md)
