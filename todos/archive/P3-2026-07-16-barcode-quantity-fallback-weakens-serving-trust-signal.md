<!-- Filename: P{0-3}-YYYY-MM-DD-short-description.md  (P0=critical … P3=low) -->

---

title: "Barcode lookup's `quantity` fallback weakens the real-serving-data trust signal"
status: done
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

- [x] Decide whether `hasServingData` (and/or `isServingDataTrusted`) should be derived from `offProduct?.serving_size` specifically, excluding the `quantity` fallback — or some other way of distinguishing a real per-serving label from a package-quantity guess
- [x] If changed, confirm the existing multi-pack-correction tests and the P2-2026-07-14 regression tests still pass
- [x] Add a regression test for a product where only `quantity` (not `serving_size`) is present and its value is a whole-package weight under the correction thresholds

## Implementation Notes

Relevant code: `server/services/barcode-lookup.ts` lines ~287-288 (`rawServing` construction) and ~483-488 (`hasServingData` derivation, `MAX_PLAUSIBLE_SERVING_CALORIES` / `MAX_PLAUSIBLE_SERVING_GRAMS` thresholds in the correction block). The correction block only fires when `calPerServing > 800` or `servingGrams > 500` (both strict `>`), and is skipped entirely when `per100g.calories === undefined` — so there's a window where a whole-package `quantity` slips through without correction or an `(estimated)` caveat.

## Dependencies

- None known

## Risks

- Low — this is a narrow edge case (package quantity happens to be small enough to pass plausibility checks) affecting labeling accuracy, not a crash or data-loss risk

## Updates

### 2026-07-16

- Filed during review of P2-2026-07-14-scanned-nutrition-mislabeled-per-100g; surfaced by ai-reviewer as an out-of-scope SUGGESTION
- Fixed via `/todo`. Decision: `quantity` is excluded entirely, not merely down-weighted — it is the wrong field semantically (whole-package net weight), not a weaker version of `serving_size`. `rawServing` (and everything derived from it — `servingGrams`, the correction block, `hasServingData`/`isServingDataTrusted`) now reads `offProduct?.serving_size` only; `offProduct?.quantity` is no longer read anywhere in `lookupBarcode`. A quantity-only product now behaves identically to the pre-existing "no serving data at all" case: falls back to per-100g values, `isServingDataTrusted: false`, `wasCorrected: false`.
- All 4 existing P2-2026-07-14 regression tests still pass unchanged (all four fixtures use `serving_size`, never `quantity`). Added two new regression tests in `server/services/__tests__/barcode-lookup.test.ts`: a quantity-only product under the correction thresholds (the exact scenario this todo describes), and a quantity-only product over the thresholds (confirming the correction block no longer receives quantity-sourced values at all — a scenario surfaced by `ai-reviewer` during this todo's own review).
- Reviewed by `code-reviewer` (no findings) and `ai-reviewer` (2 SUGGESTIONs, both applied: a code comment clarifying there's no partial-trust middle ground for `quantity` and pointing at OFF's `serving_quantity` field as the correct future source, plus the second regression test above).
- Updated `docs/solutions/conventions/indicate-data-source-to-users-2026-05-13.md`'s Exceptions section, which described the pre-fix formula, to reflect that `hasServingData` is now `serving_size`-specific.
- Deferred (out of scope): `client/lib/serving-size-utils.ts` has the identical `serving_size || quantity` conflation in its OFF-fallback path (used only when the server is unreachable) — not touched here; see DEFERRED_WARNINGS in the executor report.
