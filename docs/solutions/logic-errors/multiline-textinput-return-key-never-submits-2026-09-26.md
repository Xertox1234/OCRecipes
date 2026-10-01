---
title: A multiline TextInput's return key inserts a newline and never calls onSubmitEditing — returnKeyType only relabels the key
track: bug
category: logic-errors
module: client
severity: medium
tags: [react-native, accessibility, textinput, keyboard, submit, testing]
symptoms: ['The keyboard shows a "search", "done" or "go" key, but pressing it does nothing except add a line break', 'onSubmitEditing is wired and unit-tested, yet never fires on a device', 'A screen has an on-screen submit button that works while the keyboard key silently does not', 'A test asserts returnKeyType and passes, while the key still does not submit']
applies_to: [client/**/*.tsx]
created: '2026-09-26'
---

# A multiline TextInput's return key inserts a newline and never calls onSubmitEditing — returnKeyType only relabels the key

## Problem

`QuickLogScreen`'s food input was `multiline` with `returnKeyType="search"` and
`onSubmitEditing={handleTextSubmit}`. The keyboard showed a blue search key. Pressing it
only inserted a newline; the parse never ran. Only the on-screen Parse button worked.

## Symptoms

- A labelled return key ("search", "done", "go") that adds a line break instead of submitting.
- `onSubmitEditing` present in the code and never called on device.

## Root Cause

`returnKeyType` changes only the key's label. Whether the key submits is `submitBehavior`,
and RN (0.81, `Libraries/Components/TextInput/TextInput.js`) derives its default from
`multiline`:

| Input                | `submitBehavior` default | Return key does                 |
| -------------------- | ------------------------ | ------------------------------- |
| single-line          | `blurAndSubmit`          | submits and dismisses keyboard  |
| `multiline`          | `newline`                | inserts `\n`, never submits     |

(The deprecated `blurOnSubmit` still feeds the same derivation.)

## Solution

Set `submitBehavior` explicitly on any multiline input whose return key should submit:

```tsx
<TextInput
  multiline
  returnKeyType="done"
  // Multiline defaults to "newline": the key would never submit.
  submitBehavior="blurAndSubmit"
  onSubmitEditing={handleSubmit}
/>
```

Use `blurAndSubmit` when results render below the input (the keyboard would cover them);
`submit` keeps the keyboard up. Keep the two surfaces of one feature consistent — the Home
Quick Log drawer is single-line, so it already blurred on submit.

## Prevention

- When a return key "does nothing", check `multiline` before anything else.
- **Testing limit:** the shared RN mock (`test/mocks/react-native.ts`) spreads unknown props
  onto an `<input>`, so `returnKeyType` / `submitBehavior` are assertable via
  `getAttribute`, but React drops `onSubmitEditing` as an unknown event handler. A Vitest
  test can prove the prop values, not that the key submits. Verify the key press on a
  simulator or device, and say so in the PR.
- The same mock did not map `accessibilityState.expanded` to `aria-expanded` until
  2026-09-26, so a test asserting its *absence* passed vacuously. Pair every absence
  assertion on a mocked a11y attribute with a positive control that sees it present.

## Related Files

- `client/screens/QuickLogScreen.tsx` — the multiline input, fixed in #1116
- `client/components/home/QuickLogDrawer.tsx` — the single-line sibling
- `client/screens/__tests__/QuickLogScreen.test.tsx` — prop-value assertions
- `test/mocks/react-native.ts` — TextInput and accessibilityState mapping

## See Also

- [accessibility props pattern](../design-patterns/accessibility-props-pattern-2026-05-13.md) — how the RN mock surfaces a11y props in jsdom
