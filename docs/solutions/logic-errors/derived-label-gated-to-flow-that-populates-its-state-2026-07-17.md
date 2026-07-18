---
title: A derived caption on a multi-mode screen must be gated to the entry modes that populate its source state — other modes render it from defaults
track: bug
category: logic-errors
tags: [nutrition, serving-size, multi-mode-screen, derived-state, ui-labels, design-import]
module: client
symptoms: [A "Per serving" / "Per 100 g" style caption showing a generic or wrong unit on the saved-item (itemId) view, A caption derived from useState defaults because the entry mode never runs the flow that sets them, Label contradicting an adjacent "Serving size X" line for the same item]
created: 2026-07-17
severity: medium
---

# A derived caption on a multi-mode screen must be gated to the entry modes that populate its source state — other modes render it from defaults

## Problem

`NutritionDetailScreen` serves three entry modes (barcode scan, `imageUri`,
saved-item `itemId`) through one component. The 2026-07 redesign added a hero
caption `Per {quantity} × {serving}` derived from the serving-selection state
(`servingSizeGrams`, `servingQuantity`, `isPer100g`). Only the barcode flow
ever populates that state; the `itemId` view just does `setNutrition(existingItem)`
and leaves the `useState` defaults. Rendered unconditionally, the caption
claimed "Per serving" over values that are actually the **already-scaled total
for the logged quantity** — a saved "2 × 250 ml" (500 kcal) entry read as
"Per serving — 500 kcal".

## Symptoms

- Generic fallback label ("Per serving") on exactly one entry mode, correct
  labels on another.
- The caption contradicts an adjacent line (`Serving size: {original}`) for
  the same item.
- Unit tests for the label helper all green — the pure function is correct;
  the defect is which flow renders it.

## Root Cause

Multi-mode screens share local state across modes, but not every mode runs the
code that populates it. A derived label reads that state unconditionally, so
modes outside the owning flow render it from `useState` defaults — and the
default branch of a well-tested pure helper produces a *plausible-looking*
wrong claim rather than an obvious blank.

## Solution

Gate the derived label on the same condition that gates the controls owning
its state (here: `showServingControls`, the barcode-flow condition). A mode
that never populates the state renders no claim instead of a default-derived
one:

```tsx
{showServingControls ? (
  <ThemedText>Per {servingContextLabel}</ThemedText>
) : null}
```

Alternative when the label is wanted everywhere: thread the persisted record's
own serving fields into the derivation for the read-only mode — never let the
scan-flow defaults stand in for them.

## Prevention

- When adding any derived display to a screen with multiple entry modes,
  enumerate the modes and ask "which flow sets this state?" — render the
  display only there, or source it per-mode.
- A tested pure helper does not prove the wiring
  (see the pure-utils extraction convention); the defect lives in *which
  caller renders it*, so check the caller's mode matrix in review.

## Related Files

- `client/screens/NutritionDetailScreen.tsx` — `showServingControls` gate on the hero caption
- `client/screens/nutrition-detail-utils.ts` — `getServingContextLabel` (the correct-but-miswired helper)
- `client/hooks/useNutritionLookup.ts` — itemId path sets only `nutrition`, never serving state

## See Also

- [persisted-label-desyncs-from-its-scaled-companion-values](persisted-label-desyncs-from-its-scaled-companion-values-2026-07-16.md) — the write-time sibling: label and values must derive from the same base
- [../conventions/pure-utils-extraction-tests-dont-prove-wiring-2026-07-14.md](../conventions/pure-utils-extraction-tests-dont-prove-wiring-2026-07-14.md) — why the helper's green tests didn't catch this
