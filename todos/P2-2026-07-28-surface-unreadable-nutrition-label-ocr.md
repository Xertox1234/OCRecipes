---
title: "Surface an unreadable nutrition label instead of silently trusting the database"
status: backlog
priority: medium
created: 2026-07-28
updated: 2026-07-28
assignee:
labels: [camera, ocr, scan, nutrition, ux]
github_issue:
---

# Surface an unreadable nutrition label instead of silently trusting the database

## Summary

When the step-2 nutrition-label capture yields no usable OCR text, the scan flow
silently falls back to the barcode database value with no error, no warning, and
no indication the photographed label was ignored. On a product whose database
record is wrong, this presents a badly incorrect calorie count as if it were
verified against the package.

## Background

Observed on-device 2026-07-28 while running the device pass for #729
(VisionCamera 5.1.1 + MLKit 9), on **Cherry Coke, barcode `06772408`**.

OpenFoodFacts' record for that barcode is wrong — every field is low by the same
~3.8×:

```
energy-kcal_serving:  39.4      (real: ~140 per 355 mL can)
energy-kcal_100g:     11.11
sugars_serving:       11 g      (real: ~42 g)
```

Two scans of the same product in the same session produced different outcomes:

- **Scan A** — the label was read. The Trust-the-Label conflict UI appeared with
  Label vs Database side by side, Label reading **140 kcal, matching the can**.
  Working exactly as designed (PR #695).
- **Scan B** — the label was not read. The screen showed **39 kcal** with no
  conflict UI, no error, and nothing distinguishing it from a verified reading.

The user action was identical. The only difference was whether that particular
capture produced readable text. This is **not** an MLKit 9 regression — AC #4 of
`P2-2026-07-25-mlkit-9-unblock-visioncamera-511.md` was closed on the same device
in the same session — it is a pre-existing gap in the failure path.

The whole point of "Trust the Label" is products whose database entry is wrong.
That is precisely the case where a silent fallback does the most damage: the user
photographed the label specifically because they wanted it used, and the app
discarded that intent without saying so.

## Acceptance Criteria

- [ ] When step-2 OCR yields no usable text, the user is told the label could not
      be read — not left with an unlabelled database value
- [ ] The message offers the obvious recovery (retake the label photo)
- [ ] A successful label read is unchanged — no new message on the happy path
- [ ] The distinction is explicit in code: "no label was captured" and "a label
      was captured but unreadable" are different states, not both `""`
- [ ] Test covers the unreadable-label path asserting the user-visible signal
- [ ] Existing `useNutritionLookup` / scan-phase tests still pass

## Implementation Notes

The silence comes from two places that both coerce "unreadable" into "absent":

1. `client/camera/reducers/scan-phase-reducer.ts` — `STEP_PHOTO_CAPTURED` stores
   `ocrText: action.ocrText ?? ""`, collapsing a failed read into an empty string.
2. `client/hooks/useNutritionLookup.ts:258` —
   `const parsedLabel = ocrText ? parseNutritionFromOCR(ocrText) : null;`
   An empty string is falsy, so the label branch is skipped entirely and the DB
   result stands.

Note the override itself is **not** at fault and needs no change. Verified
2026-07-28 by replaying it against the real OFF record: given well-formed label
text, `parseNutritionFromOCR` yields `150 / 42g / "1 can (355 mL)"`, and all four
`buildLabelConflict` gates pass (`parseServingGrams("1 can (355 mL)")` → 355;
conflict 74% ≫ the 25% threshold). Do not modify `server/services/label-override.ts`.

Also worth distinguishing "OCR returned nothing at all" from "OCR returned text
but no nutrition fields parsed" — the second is a legible-but-not-a-nutrition-panel
case (e.g. the user photographed the front of the pack), and deserves different
wording from a blurry capture.

Consider whether the existing `confidence` value from `parseNutritionFromOCR`
(0.6 on the Cherry Coke sample) should gate the message too — a very low
confidence parse may be worth flagging even when fields were extracted. Treat
that as optional; the required behaviour is the empty-read case.

## Scope Contract

- **Mechanisms to use:** the existing toast/inline-error surfaces already used by
  the scan flow — no new notification mechanism
- **Files in scope:** `client/hooks/useNutritionLookup.ts`,
  `client/camera/reducers/scan-phase-reducer.ts`,
  `client/camera/types/scan-phase.ts`, `client/screens/ScanScreen.tsx`, and their
  co-located `__tests__/`
- **Explicitly out of scope:** `server/services/label-override.ts` and
  `client/lib/nutrition-ocr-parser.ts` — both verified correct
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None. Independent of #729 — this is pre-existing on `main`.

## Risks

- **Over-warning.** OCR misses are presumably common on curved/glossy packaging;
  a message on every imperfect capture would train users to dismiss it. Fire only
  when the label genuinely contributed nothing.
- **Wrong blame.** The message must not imply the _database_ value is wrong — it
  may be fine. The honest statement is that the label was not used.

## Updates

### 2026-07-28

- Filed from the #729 device pass. Root cause traced to the two coercion points
  above; the override logic itself was verified correct and is out of scope.
