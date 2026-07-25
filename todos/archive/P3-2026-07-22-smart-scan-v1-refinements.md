---
title: "Smart Scan v1 — behavior refinements + surface parity"
status: done
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

- [x] Caffeine "Contains" false-positive on explicit zero: `hasCaffeineSignal` in `universal-flags.ts` treats an explicit `caffeine: 0` (a decaf declaring zero for provenance) as a presence signal → "Contains caffeine". Add a `> 0` guard on the numeric branches (leave the category/ingredient-text presence clauses intact). **ALREADY IMPLEMENTED in main** (shipped as part of PR #694/#708 — the `caffeineFree` gate + `> 0` numeric guards already exist in `universal-flags.ts`, and `universal-flags.test.ts` already has fixtures for `koffeinfrei`/`caffeine-free`/`sin cafeína`/explicit-0). Verified via git log + reading the current code; no change made, caffeine tests intentionally untouched.
- [x] Confirm-card parity: the `returnAfterLog` confirm-card overlay (`ScanScreen.tsx`) still shows safety-tier flags only, diverging from the scan-lock chip (which now shows warn-level universal flags too). Decide whether to surface warn-level universal flags there for consistency (it diverges in the _safe_ direction today — never shows info flags). **FIXED** — extracted the shared `pickTopDisplayFlag` composition helper (`shared/types/scan-flags.ts`) and wired both `ScanScreen.tsx`'s `fetchProductInfo` (scan-lock chip) and `ScanScreenConfirmOverlay-utils.ts`'s `buildLoadedConfirmCard` (confirm-card) through it, closing the gap that a prior refactor (#708) introduced by updating only one call site.
- [x] `effectivePer100g` back-calc gap (`useNutritionLookup.ts` ~118-137): the itemId/history-load path builds a `NutritionPer100g` literal without the 4 new nutrients. **First verify** whether `/api/scanned-items/:id` payload carries `saturatedFat/transFat/cholesterol/caffeine`; only if it does, a serving-size adjustment on that history screen would drop them — then carry the 4 fields through the back-calc. If the payload doesn't carry them, this is a no-op (close as won't-fix). **VERIFIED WON'T-FIX** — the `scanned_items` Drizzle table (`shared/schema.ts`) has no columns for these 4 nutrients at all, so the payload never carries them; nothing to carry through. Added a comment documenting this for future maintainers; no functional change.
- [ ] (Optional, v2-facing) Consider gating the scan-lock chip's `accessibilityLiveRegion="assertive"` announce to `warn`+ severity even among safety flags, so a mild-allergen info-severity flag surfaces visually without an assertive interrupt (the chip is currently the only signal for mild allergens — weigh against losing that announce). **DEFERRED — implemented, then reverted after review.** mobile-reviewer flagged a real risk: this chip is the ONLY Android TalkBack signal for a mild allergen match, and downgrading `assertive`→`polite` risks the announcement being coalesced/dropped when a concurrent name announcement fires in the same commit — unverified without on-device TalkBack testing (`docs/solutions/best-practices/verify-talkback-behavior-via-emulator-logcat-2026-06-23.md`). Given this AC item was explicitly optional/v2-facing and touches a safety-adjacent surface, reverted rather than ship an unverified accessibility regression risk. Needs on-device verification before attempting again.
- [x] Heads-up a11y summary label vs render count (finding #4, PR #694 medium review): `headsUpSummaryLabel(partition.universal)` in `NutritionDetailScreen.tsx` counts the FULL universal array while only `partition.universal.slice(0, 6)` renders as badges. If universal flags ever exceed 6 (a v2 that adds a 7th nutrient/processing/sweetener kind), a screenreader hears a summary describing more flags than are visible, with no "+N more" affordance. Fix: slice the label input to match the render, or add the "+N more" count text. Latent only — bounded at exactly 6 kinds today, so not yet reachable. **FIXED** — hoisted a single `universalToShow = partition.universal.slice(0, 6)` used by both the label and the render, so the two structurally can't desync again.

## Implementation Notes

Files: `server/services/universal-flags.ts`, `client/screens/ScanScreen.tsx`, `client/camera/components/ProductChip.tsx`, `client/hooks/useNutritionLookup.ts`. The `effectivePer100g` item is fail-safe today (missing fields render nothing, never wrong data) — verify the server payload before doing any work. Run related vitest + `tsc` after each change.
