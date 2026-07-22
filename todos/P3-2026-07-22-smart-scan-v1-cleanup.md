---
title: "Smart Scan v1 — dead-data + naming cleanup"
status: backlog
priority: low
created: 2026-07-22
updated: 2026-07-22
assignee:
labels: [deferred, cleanup, scan]
github_issue:
---

# Smart Scan v1 — dead-data + naming cleanup

## Summary

Remove write-only fields and stale names left by the Smart Scan universal-flags feature (PR #694). All cosmetic/tidy — no behavior change.

## Background

Two whole-branch reviewers independently flagged `NutritionData.novaGroup`/`nutriScore` as written-but-never-read (display goes through `flags[]`), plus a few naming leftovers from the Task-14 `safetyFlag → topFlag` swap. Deferred to keep the feature diff minimal.

## Acceptance Criteria

- [ ] Drop `novaGroup`/`nutriScore` scalar fields from `NutritionData` and their assignments in `useNutritionLookup.ts` (display is via the `nutriscore:*` flag + `processing:ultra` flag — the scalars have no reader). OR wire a consumer if a scalar render is intended.
- [ ] Decide the caffeine flag's `value: { amount, unit }` field (`universal-flags.ts`): render it in `ScanFlagBadge` (e.g. "High in caffeine — 160 mg") or drop it (the mg already shows via the Additional-Nutrients caffeine row).
- [ ] Rename `ProductChip.tsx` `safetyFlagTitle`/`safetyFlagDetail`/`prevSafetyFlagTitleRef`/`styles.safetyFlag`/`styles.safetyFlagText` → `topFlag*` (they now source `topFlag`); rename the test file `ProductChip.safetyFlag.test.tsx` (it tests `topFlag`).
- [ ] `universal-flags.ts` `nutrientFlag(key, nk, …)`: collapse the always-identical `key`/`nk` params to one.
- [ ] `universal-flags.ts` sodium `NUTRIENT_META.sodium.detail`: reconcile "salt" wording vs the `sodium` id/mg display (FSA guidance is salt-denominated — either keep with a comment or align copy).
- [ ] `partitionScanFlags` (`nutrition-detail-flags-utils.ts`): add a defensive default so a future unmodeled `kind`/`insight`-tier flag doesn't silently vanish from both sections.
- [ ] (Optional polish) Unify the Additional-Nutrients card rounding — all 7 rows on `roundToOneDecimal` (currently old rows use `Math.round`, new rows use `roundToOneDecimal`; only visible on fractional values).
- [ ] `ScanScreen.tsx` `fetchProductInfo`: `pickTopSafetyFlag(flags)` is called twice (once for `safetyFlag`/haptic, once inside the `topFlag = pickTopSafetyFlag(flags) ?? …` composition). Reuse the `safetyFlag` local: `const topFlag = safetyFlag ?? pickTopFlag(…)`. Pure-function micro-nit, no behavior change.

## Implementation Notes

Files: `client/hooks/useNutritionLookup.ts`, `client/camera/components/ProductChip.tsx` (+ its test), `server/services/universal-flags.ts`, `client/screens/nutrition-detail-flags-utils.ts`, `client/screens/NutritionDetailScreen.tsx`. All low-risk; run the related vitest files + `tsc` after.
