---
title: "A shared wrapper's style appended after the caller's overrides a larger caller value — compute max(floor, caller) instead"
track: bug
category: logic-errors
tags: [react-native, design-system]
module: client
applies_to: ["client/components/**/*.tsx"]
symptoms: ["Two 100px multi-line fields (Notebook note, AI prompt) rest at ~56px after gaining a floating label", "Only labelled instances shrink; the same field without `label` keeps its height"]
created: 2026-10-26
severity: medium
---

# A shared wrapper's style appended after the caller's overrides a larger caller value — compute max(floor, caller) instead

## Problem

`FocusField` gives a labelled field room for its floating label with `style={[style, label ? styles.labelled : null]}`, where `labelled` is `{ minHeight: 56 }`.

In a React Native style array the last entry wins. So a caller's `minHeight: 100`, which reaches the box through `splitFieldStyle`, was silently replaced by 56. Both 100px multi-line boxes shrank, and nothing failed.

## Symptoms

- Labelled multi-line fields are shorter than their own styles say. They grow only as text wraps.
- No test fails, and the per-task simulator check missed it because it looked at a different screen. The final whole-plan review caught it.

## Root Cause

The wrapper meant "at least 56", but an appended style entry means "exactly what I say". The floor was written as an override.

## Solution

Compute the floor from the caller's value instead of appending a fixed one:

```tsx
// field-focus-utils.ts: labelledMinHeight(callerMinHeight) → max(56, caller value when numeric)
<Animated.View
  style={[style, label ? { minHeight: labelledMinHeight(flat.minHeight) } : null]}
/>
```

Test both directions: a caller value of 100 keeps 100, and no caller value gets 56.

## Prevention

When a shared primitive adds a **minimum** (`minHeight`, `minWidth`, padding floors) on top of a caller's style, merge with `max()`. Never append it as a later style entry. An appended entry is right only for values the primitive must own outright.

## Related Files

- `client/components/FocusField.tsx`, `client/components/field-focus-utils.ts` (`labelledMinHeight`)
- `client/components/__tests__/FocusField.test.tsx`

## See Also

- [hook-returned stable component reading a ref](hook-returned-stable-component-reading-ref-goes-blank-under-compiled-host-2026-10-01.md) — another silent shared-primitive regression found only on screen
