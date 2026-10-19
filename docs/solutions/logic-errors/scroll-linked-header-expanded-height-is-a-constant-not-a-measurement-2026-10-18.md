---
title: A scroll-linked header's expanded height is a constant, not a measurement — a row removed from the header leaves its height behind as dead space
track: bug
category: logic-errors
tags: [react-native, layout, header, reanimated, scroll, useScrollLinkedHeader, dead-space]
module: client
applies_to: ["client/hooks/useScrollLinkedHeader.ts", "client/screens/meal-plan/RecipeBrowserScreen.tsx", "client/screens/HomeScreen.tsx", "client/screens/ProfileScreen.tsx"]
symptoms: ["A blank band sits between a header row and the list below it, in both light and dark, on every device", "A control sits alone on a row with empty space around it and the gap does not match any margin in the stylesheet", "The header's children add up to less than the `expandedHeight` passed to `useScrollLinkedHeader`"]
created: 2026-10-18
last_updated: 2026-10-18
severity: low
---

# A scroll-linked header's expanded height is a constant, not a measurement

## Symptom

The recipe browser showed "+ Add" alone on a row with dead space around it (visual QA sweep #8, 2026-10-11). The stylesheet had no margin that explained the gap, and the row itself was only 44pt tall.

## Cause

`useScrollLinkedHeader({ expandedHeight, collapsedHeight, collapseThreshold })` interpolates the header's `height` style between two **numbers the caller passes in**. Nothing measures the children. `RecipeBrowserScreen` passed `RECIPE_HEADER_EXPANDED = 160`, sized for an earlier header that held tabs plus an action row plus the filter chips. When the tabs went, the constant stayed, so the `overflow: "hidden"` container was 160pt tall around ~112pt of content and the difference rendered as blank space inside the header, right where the lone button sat.

The same shape exists in `HomeScreen` and `ProfileScreen`: each passes its own constant.

## Fix

When a row leaves (or joins) a header that uses this hook, re-derive the constant from the rows that remain and their paddings, then check it on the simulator in the expanded state (a gap below the last row) and the collapsed state (a row clipped mid-way). PR #1512 moved the Add button onto the chip row and set the constant to 60: one 44pt row plus the header area's bottom padding.

```ts
// One 44pt filter row plus the header area's bottom padding.
const RECIPE_HEADER_EXPANDED = 60;
```

The constant is the right design — the hook needs a known target to interpolate towards before the first layout — but it is a number that must move with the JSX above it.

## How to tell this from a margin bug

Measure on a screenshot: the gap equals `expandedHeight − (sum of row heights + paddings)`. A margin bug is in the stylesheet; this one is in the hook's argument.

## Related

- `client/hooks/useScrollLinkedHeader.ts` — the interpolation; `reducedMotion` pins the header at `expandedHeight`, so the dead space also shows with Reduce Motion on.
- Visual QA sweep #8; PR #1512.
