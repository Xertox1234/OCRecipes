---
title: "Smart Scan v1 — behavior refinements + surface parity"
status: backlog
priority: low
created: 2026-07-22
updated: 2026-07-22
assignee:
labels: [deferred, scan]
github_issue:
---

# Smart Scan v1 — behavior refinements + surface parity

## Summary

Small, non-blocking behavior refinements to the Smart Scan universal-flags feature (PR #694), all ruled ship-with-follow-up by the whole-branch review.

## Background

Each item is a narrow edge case or a surface-consistency gap the reviewers judged acceptable for v1 but worth tidying. None is a correctness defect on the primary fresh-scan path.

## Acceptance Criteria

- [ ] Caffeine "Contains" false-positive on explicit zero: `hasCaffeineSignal` in `universal-flags.ts` treats an explicit `caffeine: 0` (a decaf declaring zero for provenance) as a presence signal → "Contains caffeine". Add a `> 0` guard on the numeric branches (leave the category/ingredient-text presence clauses intact).
- [ ] Confirm-card parity: the `returnAfterLog` confirm-card overlay (`ScanScreen.tsx`) still shows safety-tier flags only, diverging from the scan-lock chip (which now shows warn-level universal flags too). Decide whether to surface warn-level universal flags there for consistency (it diverges in the _safe_ direction today — never shows info flags).
- [ ] `effectivePer100g` back-calc gap (`useNutritionLookup.ts` ~118-137): the itemId/history-load path builds a `NutritionPer100g` literal without the 4 new nutrients. **First verify** whether `/api/scanned-items/:id` payload carries `saturatedFat/transFat/cholesterol/caffeine`; only if it does, a serving-size adjustment on that history screen would drop them — then carry the 4 fields through the back-calc. If the payload doesn't carry them, this is a no-op (close as won't-fix).
- [ ] (Optional, v2-facing) Consider gating the scan-lock chip's `accessibilityLiveRegion="assertive"` announce to `warn`+ severity even among safety flags, so a mild-allergen info-severity flag surfaces visually without an assertive interrupt (the chip is currently the only signal for mild allergens — weigh against losing that announce).

## Implementation Notes

Files: `server/services/universal-flags.ts`, `client/screens/ScanScreen.tsx`, `client/camera/components/ProductChip.tsx`, `client/hooks/useNutritionLookup.ts`. The `effectivePer100g` item is fail-safe today (missing fields render nothing, never wrong data) — verify the server payload before doing any work. Run related vitest + `tsc` after each change.
