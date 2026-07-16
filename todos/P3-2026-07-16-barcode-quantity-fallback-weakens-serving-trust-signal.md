<!-- Filename: P{0-3}-YYYY-MM-DD-short-description.md  (P0=critical … P3=low) -->

---

title: "Barcode lookup's `quantity` fallback weakens the real-serving-data trust signal"
status: backlog
priority: low
created: 2026-07-16
updated: 2026-07-16
assignee:
labels: [deferred, nutrition, barcode]
github_issue:

---

# Barcode lookup's `quantity` fallback weakens the real-serving-data trust signal

## Summary

`server/services/barcode-lookup.ts`'s `rawServing` is built from `offProduct?.serving_size || offProduct?.quantity || ""`, and the `hasServingData` flag (added in P2-2026-07-14-scanned-nutrition-mislabeled-per-100g) trusts either source equally. `quantity` is frequently the whole-package net weight, not a per-serving amount, so a package whose `quantity` happens to fall under the existing implausibility thresholds can be labeled `isServingDataTrusted: true` without ever being flagged as an estimate.

## Background

Surfaced by the `ai-reviewer` during review of P2-2026-07-14-scanned-nutrition-mislabeled-per-100g (the `isServingDataTrusted` mislabeling fix). Not a regression introduced by that fix — the correction thresholds and the `quantity` fallback are pre-existing — but the reviewer noted a labeled serving size (`serving_size`) is a materially stronger signal than a package-quantity fallback (`quantity`), and the two are currently treated identically.

## Acceptance Criteria

- [ ] Decide whether `hasServingData` (and/or `isServingDataTrusted`) should be derived from `offProduct?.serving_size` specifically, excluding the `quantity` fallback — or some other way of distinguishing a real per-serving label from a package-quantity guess
- [ ] If changed, confirm the existing multi-pack-correction tests and the P2-2026-07-14 regression tests still pass
- [ ] Add a regression test for a product where only `quantity` (not `serving_size`) is present and its value is a whole-package weight under the correction thresholds

## Implementation Notes

Relevant code: `server/services/barcode-lookup.ts` lines ~287-288 (`rawServing` construction) and ~483-488 (`hasServingData` derivation, `MAX_PLAUSIBLE_SERVING_CALORIES` / `MAX_PLAUSIBLE_SERVING_GRAMS` thresholds in the correction block). The correction block only fires when `calPerServing > 800` or `servingGrams > 500` (both strict `>`), and is skipped entirely when `per100g.calories === undefined` — so there's a window where a whole-package `quantity` slips through without correction or an `(estimated)` caveat.

## Dependencies

- None known

## Risks

- Low — this is a narrow edge case (package quantity happens to be small enough to pass plausibility checks) affecting labeling accuracy, not a crash or data-loss risk

## Updates

### 2026-07-16

- Filed during review of P2-2026-07-14-scanned-nutrition-mislabeled-per-100g; surfaced by ai-reviewer as an out-of-scope SUGGESTION
