---
title: "Extend Atwater self-consistency fallback to OFF entries with per-serving energy but unparseable serving grams"
status: done
priority: low
created: 2026-07-24
updated: 2026-07-24
assignee:
labels: [deferred, nutrition, barcode]
github_issue:
---

# Extend Atwater fallback to entries with per-serving energy but unparseable serving grams

## Summary

`offSelfConsistent` in `server/services/barcode-lookup.ts` only reaches the new Atwater energy-vs-macros fallback when `offPerServingCal === undefined`. When per-serving energy IS present but the `serving_size` string has no parseable grams (`offLabelGrams === null`, e.g. "1 bottle", a US fl-oz label), the per-serving ratio check can't run and the code falls straight to `return false` — leaving the entry unshielded even though its per-100g energy could still self-corroborate via its own macros.

## Background

Surfaced by the ai-reviewer during the P2-2026-07-22 barcode source-pollution fix. It's a natural extension of that fix's principle (identity-matched self-consistent data must not be replaced by a name-matched secondary), for a smaller population than the no-per-serving-energy case the primary fix already covers. Pre-existing gap, not a regression from that fix.

## Acceptance Criteria

- [x] When `offPerServingCal` is present/positive but `offLabelGrams` is null/≤0, fall back to `offMacrosCorroborateEnergy(offPer100g)` instead of returning false outright.
- [x] Do NOT change the explicit-zero branch or any case where grams ARE parseable (the per-serving×grams check stays authoritative there).
- [x] Add a regression test: OFF entry with `energy-kcal_serving` present, `serving_size` unparseable (e.g. "1 bottle"), Atwater-consistent per-100g macros, and a disagreeing name-matched secondary → OFF kept (`openfoodfacts+self-consistent`), secondary rejected.
- [x] Confirm the existing "shields an explicit 0-and-0 product even when serving_size is unparseable" test still passes (zero branch is separate and must be untouched).

## Outcome (2026-07-24)

The single guard `if (offLabelGrams === null || offLabelGrams <= 0 || offPerServingCal <= 0 || offPer100g.calories <= 0) return false;` was split so the two conditions get the treatment they each deserve:

- `offPerServingCal <= 0 || calories <= 0` → still `return false` (unchanged, out of this todo's scope).
- `offLabelGrams` unusable → `return offMacrosCorroborateEnergy(offPer100g)`.

The framing that makes this correct: unparseable grams are a **missing signal**, not a detected contradiction. Where grams DO parse, the per-serving × grams check keeps its authority — including when it disagrees — so the fallback cannot swallow the contradictions the replace-arm exists to surface.

Two tests, both pinned against the real branch behaviour:

- `serving_size: "1 bottle"` + `energy-kcal_serving: 230` + Atwater-consistent macros (45.8 ≈ 46) + a CNF match at 250 → OFF kept at 46, `openfoodfacts+self-consistent`. **Verified red before the fix** (`expected 250 to be 46`).
- The mirror case with `serving_size: "500 ml"` (parseable) and a contradictory `energy-kcal_serving: 99` → CNF's 250 still wins. Atwater alone _would_ have shielded this entry, so this test is what proves the ratio arm's verdict still outranks it.

96 tests pass across `barcode-lookup`, `nutrition-lookup`, and `universal-flags`.

## Implementation Notes

- The change is inside the `offSelfConsistent` IIFE's final `if (offLabelGrams === null || …) return false;` guard — OR in the Atwater check there rather than returning false.
- Reuse the already-exported `offMacrosCorroborateEnergy` helper; no new helper needed.

## Scope Contract

- **Mechanisms to use:** the existing `offMacrosCorroborateEnergy` helper + `offSelfConsistent` IIFE — nothing new.
- **Files in scope:** `server/services/barcode-lookup.ts`, `server/services/__tests__/barcode-lookup.test.ts`.
- No new mechanisms, files, or abstractions.

## Dependencies

- None (builds on the merged P2-2026-07-22 fix).

## Risks

- Low. Confined to a narrow branch; must preserve the zero-agreement and parseable-grams paths exactly (pin with the existing tests).

## Updates

### 2026-07-24

- Filed as a review follow-up (ai-reviewer SUGGESTION) to the P2-2026-07-22 barcode source-pollution fix.
