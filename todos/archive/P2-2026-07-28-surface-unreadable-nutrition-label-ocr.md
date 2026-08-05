---
title: "Surface an unreadable nutrition label instead of silently trusting the database"
status: done
priority: medium
created: 2026-07-28
updated: 2026-08-05
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

- [x] When step-2 OCR yields no usable text, the user is told the label could not
      be read — not left with an unlabelled database value
      — a warning notice on NutritionDetailScreen, reusing the existing
      `correctionNotice` surface (`accessibilityLiveRegion="polite"`).
- [x] The message offers the obvious recovery (retake the label photo)
      — asserted by test, not just written.
- [x] A successful label read is unchanged — no new message on the happy path
      — and barcode-only scans stay silent too: they never promised to use a
      label, so warning there would train the user to dismiss it.
- [x] The distinction is explicit in code: "no label was captured" and "a label
      was captured but unreadable" are different states, not both `""`
      — `ocrText` is three-valued end to end (reducer → phase types → nav params
      → hook): `undefined` / `null` / string. Whitespace-only normalises to
      `null` as well; MLKit can return a stray newline for a glare-washed panel,
      which is truthy and would have sailed past the old guard.
- [x] Test covers the unreadable-label path asserting the user-visible signal
      — 5 hook cases + 4 reducer cases. Includes the optional "text but no
      nutrition fields" split from Implementation Notes, since the two failures
      need different recovery (retake vs photograph the other side).
- [x] Existing `useNutritionLookup` / scan-phase tests still pass
      — 47 reducer+hook, 433 across camera and screens.

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
  — **CORRECTION (2026-08-05): the parser half of that claim was wrong.** It
  held for this todo (the scope exclusion was right, and nothing here needed to
  change), but it must not be carried forward as a standing fact. See the
  Outcome section.
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
- **IMPLEMENTED** (`cf0584ef`). Both coercion points fixed; all six acceptance
  criteria closed. `server/services/label-override.ts` and
  `client/lib/nutrition-ocr-parser.ts` untouched, as specified.

  One deviation worth recording: the Implementation Notes listed the
  "text recognised but no nutrition fields" split as **optional**. It is
  implemented, because the two failures need genuinely different recovery —
  "retake the photo" is wrong advice for someone who photographed the front of
  the pack, and identical copy would make it a coin-flip. The `confidence`
  gating, also listed as optional, is **not** implemented: it risks the
  over-warning failure mode in Risks, and the required empty-read case is
  covered without it.

  Device verification is still outstanding — this was fixed against tests, not
  reproduced on hardware. The on-device check is a Cherry Coke (`06772408`) scan
  where the label capture fails: the notice must appear instead of a bare
  39 kcal.

## Outcome — closed 2026-08-05

All six acceptance criteria are met and the implementation is on `main`
(`labelReadNotice` + three-valued `ocrText` in `client/hooks/useNutritionLookup.ts`).

**Where to find it:** the fix landed under PR #734, whose squash subject is
`docs(todos): file the silent unreadable-label OCR fallback (P2)` — the branch
carried the todo file AND the fix, and the squash took the first commit's
message. Searching commit subjects for the fix finds nothing; `git log -S
"labelReadNotice"` locates it.

**Closed with one thing unverified, deliberately not re-filed.** The hardware
check described above (a failed Cherry Coke label capture showing the notice
rather than a bare 39 kcal) was never performed — it was not an acceptance
criterion, and the ACs are the contract. A gated follow-up todo would cost more
than it returns; the check is cheap to fold into the next device pass.

**Correction to the Scope Contract.** It recorded
`client/lib/nutrition-ocr-parser.ts` as "verified correct". The exclusion was
right — nothing in this todo needed to touch the parser — but the _claim_ was
false, and a device probe on 2026-08-05 disproved it:

- four `FIELD_PATTERNS` used `(\S+?)mg`, which cannot span the gap in
  `Sodium 400 mg`, so those fields were null on every bilingual label
- `\s` matches newlines and `g` matches any word's leading letter, so a field
  could assemble itself from three lines (`Trans\n15\nGLUTEN FREE` → 15)
- the recogniser's `g` → `9` substitution silently discarded macros

Fixed in #755 and #757. The original verification was real but tested the wrong
input class: it replayed _well-formed_ label text, which every pattern handles.
The defects only appear against verbatim device OCR. Codified as
`docs/solutions/logic-errors/whitespace-class-silently-sets-extraction-regex-boundary-2026-08-05.md`
and its siblings (#758).
