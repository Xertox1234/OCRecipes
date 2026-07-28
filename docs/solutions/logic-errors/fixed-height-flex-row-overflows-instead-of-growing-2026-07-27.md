---
title: A fixed-height flex row does not grow for a taller child — it overflows symmetrically, outside the border
track: bug
category: logic-errors
module: client
tags: [react-native, design-system, flexbox, layout, textinput, multiline]
applies_to: ["client/components/**/*.tsx", "client/screens/**/*.tsx"]
symptoms: ["Text renders outside the container, crossing or above its visible border", "A multiline input's caret lands on top of a label or other content", "Content spills equally above and below a bordered box rather than being clipped", "A container looks correct with short content and breaks only when a caller passes a taller child"]
created: '2026-07-27'
severity: medium
---

# A fixed-height flex row does not grow for a taller child — it overflows symmetrically, outside the border

## Problem

`client/components/TextInput.tsx` sized its bordered container with a fixed
`height` and centred its children:

```tsx
container: {
  flexDirection: "row",
  alignItems: "center",
  height: Spacing.inputHeight,   // fixed 48
  borderWidth: 1,
}
```

`CookbookCreateScreen` passes `style={{ minHeight: 92 }}` to the inner
`RNTextInput` for its multiline description field. The result was not a clipped
or scrolled field — the value text rendered **through and above the top border**,
visibly outside the box, and the caret landed on top of the floating label.

## Symptoms

- Value text drawn across the container's top border, outside the field
- Caret positioned over the label rather than in the text area
- Single-line usages of the same component look fine — only the taller caller breaks
- No warning, no error, no clipping: it simply draws outside its parent

## Root Cause

Two properties combine, and neither is wrong on its own:

1. **`height` is a hard constraint, not a starting size.** The row cannot grow to
   accommodate a child whose own `minHeight` exceeds it.
2. **`alignItems: "center"` centres the oversized child on the cross axis.** The
   92pt child is centred in a 48pt row, so the ~44pt excess is split — roughly
   22pt escaping above the border and 22pt below.

React Native does not clip overflowing children by default (`overflow: "visible"`
is the default on iOS), so the excess is *drawn*, not hidden. That is why the
failure looks like a text-positioning bug rather than a sizing bug — the visible
symptom (text in the wrong place) is several steps removed from the cause (a
container that cannot grow).

The child's `minHeight` is the tell: it is the caller declaring "I need at least
this much room," which a fixed-height parent silently refuses.

## Solution

Let the container grow, and stop centring children that should fill it:

```tsx
container: {
  flexDirection: "row",
  alignItems: "stretch",          // was "center"
  minHeight: Spacing.inputHeight, // was height
  borderWidth: 1,
},
leftIcon:  { alignSelf: "center" },  // icons opt back out of stretch
rightIcon: { alignSelf: "center" },
input: {
  flexGrow: 1,   // was height: "100%"
},
```

Why each piece matters:

- **`minHeight`** keeps the design's resting size while allowing growth. The row's
  height becomes `max(minHeight, tallest child)`, so a 92pt child produces a 92pt
  row with the border wrapping it.
- **`alignItems: "stretch"`** makes the flexible middle column adopt the row's
  height, so a percentage-free child fills it. Icons need `alignSelf: "center"`
  or they stretch too.
- **`flexGrow: 1` instead of `height: "100%"`** is the subtle one. A percentage
  height needs a *definite* parent height — which a `minHeight`-sized, auto-height
  parent does not have. `flexGrow` with the default `flexBasis: auto` keeps the
  child's intrinsic size (so its `minHeight` still drives the parent's growth)
  **and** expands it to fill any spare room, which preserves the full-height tap
  target that `height: "100%"` used to provide.

## Prevention

- A container that any caller can pass taller content into (multiline inputs,
  wrapping text, dynamic lists) should use `minHeight`, never `height`.
- Treat `alignItems: "center"` on a fixed-size cross axis as a smell: if a child
  can exceed the container, `center` converts "too big" into "spills out both
  sides" instead of anything a reviewer would notice in a short-content
  screenshot.
- When swapping `height: "100%"` for a flex rule, check the **tap target**
  separately — the visual result can look identical while the touchable area
  silently shrinks (touch targets must stay ≥44pt).
- Test the tall case. Every single-line usage of this component rendered
  correctly; only the one caller passing `minHeight` exposed the defect.

## Related Files

- `client/components/TextInput.tsx` — container/inputArea/input styles
- `client/components/text-input-utils.ts` — `LABELLED_INPUT_GEOMETRY`
- `client/screens/meal-plan/CookbookCreateScreen.tsx` — the `minHeight: 92` caller

## See Also

- [transform-origin-left-still-scales-from-vertical-center](transform-origin-left-still-scales-from-vertical-center-2026-07-27.md) — the sibling defect fixed in the same change
- [../conventions/dynamic-type-overflow-prevention-2026-05-13.md](../conventions/dynamic-type-overflow-prevention-2026-05-13.md) — the inverse case: when the fixed height is legitimate, cap text scaling instead of growing the box
