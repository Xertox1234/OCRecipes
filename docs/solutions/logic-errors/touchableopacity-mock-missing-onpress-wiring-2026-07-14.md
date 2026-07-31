---
title: A hand-written mock in the shared RN mock file drops a prop the generic helper translates
track: bug
category: logic-errors
module: client
severity: high
tags: [testing, react-native, mocks, touchableopacity, image, accessibility, vitest]
symptoms: ['A `.click()` on a rendered `TouchableOpacity` in a Vitest/jsdom test does nothing — the `onPress` handler never fires and no assertion about it ever passes', 'The equivalent test written against `Pressable` or `View` (same file, same pattern) works correctly', 'Console shows `Unknown event handler property `onPress`` or `React does not recognize the accessibilityLabel prop` when the mock renders its DOM element', '`getByLabelText` cannot find a component by its `accessibilityLabel`, even though the same query works for `View`/`Text`/`TextInput`', 'No existing test in the repo exercises that component/prop combination at all — the gap presents as ABSENT coverage, not a red test']
applies_to: [test/mocks/react-native.ts, client/**/__tests__/*.test.tsx]
created: '2026-07-14'
last_updated: '2026-07-30'
---

# A hand-written mock in the shared RN mock file drops a prop the generic helper translates

> **Recurred 2026-07-30 (PR #742) on a different component and a different
> prop.** The generalised rule is in [The general rule](#the-general-rule)
> below; the two concrete instances follow it. Two independent recurrences in
> ~2 weeks make this a structural property of `test/mocks/react-native.ts`,
> not a one-off oversight.

## The general rule

`test/mocks/react-native.ts` has **two** prop-translation paths, and only one
of them is shared:

1. `mockComponent(Element, displayName)` — the generic helper backing `View`,
   `Text`, `ScrollView` and friends. It destructures and translates the RN
   props it knows about (`accessibilityRole` → `role`, `accessibilityLabel` →
   `aria-label`, `accessibilityHint`, `accessibilityState`,
   `accessibilityLiveRegion` → `aria-live`, `testID` → `data-testid`).
2. **Hand-written `React.forwardRef` mocks** — `Pressable`, `TextInput`,
   `Image`, `TouchableOpacity`. Each re-implements translation from scratch,
   so each can silently omit one.

A prop a hand-written mock forgets falls into `...rest` and lands on the DOM
element as an unrecognised attribute. It is not translated, not queryable, and
not an error — React logs a warning at most.

**Before assuming a prop reaches the DOM in a render test, check which path
that component takes.** If it is hand-written, read it; do not infer its
behaviour from `View`'s.

The failure mode is what makes this expensive: the gap presents as an
assertion **nobody can write**, not as a failing test. There is no red to
investigate — just a class of coverage that quietly does not exist, which is
why both instances survived until someone tried to write the first test of
that kind.

## Instance 1 (2026-07-14) — TouchableOpacity never wired onPress to onClick

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

## Instance 2 (2026-07-30, PR #742) — Image never translated accessibilityLabel

`Image` is hand-written rather than built from `mockComponent`, and it was the
**only** mocked component that did not translate `accessibilityLabel`. The prop
fell into `...rest` and landed on the `<img>` as an unrecognised DOM
attribute, so `getByLabelText` could not find **any** image by its label —
anywhere in the repo. Every image-accessibility assertion was silently
unwritable, which is exactly why none existed.

```typescript
// BEFORE — accessibilityLabel falls into ...rest, lands on <img> untranslated
export const Image = React.forwardRef<unknown, Record<string, unknown>>(
  ({ source, testID, ...rest }, ref) =>
    React.createElement("img", {
      ref,
      src: /* … */,
      "data-testid": testID,
      ...rest,
    }),
);

// AFTER — translated the way mockComponent does it. `alt` carries the same
// string so the element is labelled in jsdom's own terms too; both derive
// from the one prop, so they cannot desync.
export const Image = React.forwardRef<unknown, Record<string, unknown>>(
  ({ source, testID, accessibilityLabel, ...rest }, ref) =>
    React.createElement("img", {
      ref,
      src: /* … */,
      "data-testid": testID,
      "aria-label": accessibilityLabel,
      alt: accessibilityLabel,
      ...rest,
    }),
);
```

Blast-radius check before trusting it: all 50 test files using
`getByLabelText`/`getAllByLabelText`/`ByAltText` (417 tests) plus the full
client suite (2573 tests) — zero regressions. Also grep for `toMatchSnapshot`
and for the raw lowercase `accessibilitylabel` attribute, since adding
`alt`/`aria-label` changes rendered output and an `<img>`'s implicit role.

Note the follow-on trap once labels ARE findable: `FallbackImage` puts the
same label on its placeholder as on a loaded image, so `getByLabelText` alone
still cannot tell you a real photo rendered. See the See Also link below.

## Prevention

- **Check which translation path a component takes before assuming a prop
  reaches the DOM.** `View`'s behaviour tells you nothing about `Image`'s.
- When a shared RN mock file routes a component through a generic
  `mockComponent` helper, check whether that component has an interaction
  prop (`onPress`, `onChange`, `onValueChange`, etc.) before assuming the
  generic helper is sufficient — the helper is correct for pure
  layout/display components and silently wrong for interaction ones.
- **Treat "no test in the repo does X" as a signal, not a coincidence.** Both
  instances were found by someone trying to write the first test of a kind and
  finding it impossible. If a whole category of assertion is missing across a
  mature suite, suspect the harness before concluding nobody needed it.
- Before trusting a component test that renders an interactive element,
  confirm the codebase actually has at least one passing test that clicks
  it and asserts the resulting callback fired. "Renders without crashing"
  is not evidence the interaction wiring works.
- After fixing a shared, globally-aliased test mock, run the full
  client-wide test suite (not just the touched file) as the blast-radius
  check — this exact fix was verified against a 2090-test full sweep
  before being trusted.

## Related Files

- `test/mocks/react-native.ts` — `mockComponent` (the shared path) and the
  hand-written `Pressable` / `TextInput` / `Image` / `TouchableOpacity` mocks
  (the unshared one)
- `client/camera/components/__tests__/ProductChip.test.tsx` — the
  restored click-interaction test that surfaced instance 1
- `client/screens/__tests__/NutritionDetailScreen.test.tsx` — the image-a11y
  test that surfaced instance 2

## See Also

- [Conditional Pressable rendering — View when no onPress, Pressable when provided](../design-patterns/conditional-pressable-rendering-2026-05-13.md)
- [Assert the rendered source, not the labelled node, when a fallback shares the label](../conventions/assert-source-not-label-when-fallback-shares-it-2026-07-30.md) — the next trap once image labels became findable
