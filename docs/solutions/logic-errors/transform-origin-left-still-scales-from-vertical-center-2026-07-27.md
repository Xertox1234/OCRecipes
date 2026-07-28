---
title: transformOrigin "left" pins only the horizontal axis — a scaled label still shrinks toward its vertical middle
track: bug
category: logic-errors
module: client
tags: [react-native, reanimated, animation, transform-origin, floating-label, design-system]
applies_to: ["client/components/**/*.tsx", "client/screens/**/*.tsx"]
symptoms: ["An animated label or chip travels visibly short of its intended resting position", "A scaled-down element sits lower than the translate distance predicts", "Hand-computed travel distances are consistently off by a small, constant amount", "Increasing the translate fixes the position but the gap below the element stays wrong"]
created: '2026-07-27'
severity: low
---

# transformOrigin "left" pins only the horizontal axis — a scaled label still shrinks toward its vertical middle

## Problem

`client/components/TextInput.tsx` floats its label by combining a translate with
a scale:

```tsx
transform: [
  { translateY: interpolate(labelProgress.value, [0, 1], [0, -11]) },
  { scale: interpolate(labelProgress.value, [0, 1], [1, 0.82]) },
],
// style: { transformOrigin: "left" }
```

The label never reached its intended position — it stopped short of the top of
the field and overlapped the value text below it, even though the translate
distance had been derived from the layout.

## Symptoms

- The floated label lands lower than `translateY` alone would put it
- The error is small (1–2pt) and constant, so it reads as "the design is slightly off" rather than a bug
- Compensating by increasing `translateY` moves the element but leaves the spacing below it wrong

## Root Cause

`transformOrigin: "left"` is a **one-axis** declaration. It sets the horizontal
origin to the left edge and leaves the **vertical origin at its default: center**.

So a scale applied alongside it shrinks the element toward its own vertical
middle. The transformed box top moves to `top + translateY`, but the *visible*
glyphs start lower than that by half the height lost to scaling:

```
visibleTop = top + translateY + (lineHeight - lineHeight * scale) / 2
```

With `lineHeight: 18` and `scale: 0.85`, that inset is `(18 - 15.3) / 2 = 1.35pt`
— small, but enough to eat the intended gap between the floated label and the
first line of value text. Any travel distance computed as "final top minus
resting top" is short by exactly that inset.

The compounding factor: the input text had **no explicit `lineHeight`**, so the
other half of the arithmetic was decided by platform text metrics. Two unknowns
made the spacing untunable by inspection.

## Solution

Model the inset explicitly rather than eyeballing the travel, and pin down the
text metrics so the arithmetic is yours:

```ts
export function getFloatedLabelBounds(g: LabelledInputGeometry) {
  const boxTop = g.labelRestTop + g.labelFloatTranslateY;
  const scaledHeight = g.labelLineHeight * g.labelFloatScale;
  const centerInset = (g.labelLineHeight - scaledHeight) / 2;
  return { top: boxTop + centerInset, bottom: boxTop + centerInset + scaledHeight };
}
```

Then assert the property that actually matters, rather than the constants:

```ts
it("floats the label clear of the first text line", () => {
  const floated = getFloatedLabelBounds(g);
  const line = getInputFirstLineBounds(g);
  expect(floated.bottom).toBeLessThan(line.top);
  expect(line.top - floated.bottom).toBeGreaterThanOrEqual(2);
});
```

Set an explicit `lineHeight` on the text whose position you are computing against
— without it the padding math depends on a platform default that differs between
iOS and Android.

## Prevention

- Prefer `transformOrigin: "left top"` when you want the top edge pinned, but
  **verify it renders** before relying on it — the two-value form has weaker
  support than the one-value form, and a silent fallback to center-origin
  reintroduces this exact off-by-inset. Modelling the inset (above) works
  regardless of which form the platform honours, so it is the safer default.
- Never derive an animation's travel distance from layout numbers alone when a
  `scale` is in the same transform list; scale changes where the element *appears*
  without changing its layout box.
- Any component computing positions from font metrics should declare
  `lineHeight` explicitly. Inherited metrics make the geometry unreproducible
  across platforms and untestable.
- Encode the geometry as data and test the **invariants** (things don't overlap,
  paddings fill the box) rather than the constants — a test asserting
  `translateY === -19` only restates the code, while an overlap assertion catches
  the next person who adjusts a padding.

## Related Files

- `client/components/TextInput.tsx` — the animated label style
- `client/components/text-input-utils.ts` — `LABELLED_INPUT_GEOMETRY`, `getFloatedLabelBounds`
- `client/components/__tests__/text-input-utils.test.ts` — the invariant assertions

## See Also

- [fixed-height-flex-row-overflows-instead-of-growing](fixed-height-flex-row-overflows-instead-of-growing-2026-07-27.md) — the sibling defect fixed in the same change
