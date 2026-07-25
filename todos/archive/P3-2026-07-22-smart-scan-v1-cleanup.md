---
title: "Smart Scan v1 — dead-data + naming cleanup"
status: done
priority: low
created: 2026-07-22
updated: 2026-07-24
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

- [x] Drop `novaGroup`/`nutriScore` scalar fields from `NutritionData` and their assignments in `useNutritionLookup.ts` (display is via the `nutriscore:*` flag + `processing:ultra` flag — the scalars have no reader). OR wire a consumer if a scalar render is intended.
- [x] Decide the caffeine flag's `value: { amount, unit }` field (`universal-flags.ts`): render it in `ScanFlagBadge` (e.g. "High in caffeine — 160 mg") or drop it (the mg already shows via the Additional-Nutrients caffeine row).
- [x] Rename `ProductChip.tsx` `safetyFlagTitle`/`safetyFlagDetail`/`prevSafetyFlagTitleRef`/`styles.safetyFlag`/`styles.safetyFlagText` → `topFlag*` (they now source `topFlag`); rename the test file `ProductChip.safetyFlag.test.tsx` (it tests `topFlag`).
- [x] `universal-flags.ts` `nutrientFlag(key, nk, …)`: collapse the always-identical `key`/`nk` params to one.
- [x] `universal-flags.ts` sodium `NUTRIENT_META.sodium.detail`: reconcile "salt" wording vs the `sodium` id/mg display (FSA guidance is salt-denominated — either keep with a comment or align copy).
- [x] `partitionScanFlags` (`nutrition-detail-flags-utils.ts`): add a defensive default so a future unmodeled `kind`/`insight`-tier flag doesn't silently vanish from both sections.
- [x] (Optional polish) Unify the Additional-Nutrients card rounding — all 7 rows on `roundToOneDecimal` (currently old rows use `Math.round`, new rows use `roundToOneDecimal`; only visible on fractional values).
- [x] `ScanScreen.tsx` `fetchProductInfo`: `pickTopSafetyFlag(flags)` is called twice (once for `safetyFlag`/haptic, once inside the `topFlag = pickTopSafetyFlag(flags) ?? …` composition). Reuse the `safetyFlag` local: `const topFlag = safetyFlag ?? pickTopFlag(…)`. Pure-function micro-nit, no behavior change.

## Implementation Notes

Files: `client/hooks/useNutritionLookup.ts`, `client/camera/components/ProductChip.tsx` (+ its test), `server/services/universal-flags.ts`, `client/screens/nutrition-detail-flags-utils.ts`, `client/screens/NutritionDetailScreen.tsx`. All low-risk; run the related vitest files + `tsc` after.

## Updates

### 2026-07-24

- Implemented. Notable deviations/decisions from the literal AC text:
  - Test rename target: `ProductChip.safetyFlag.test.tsx` → `ProductChip.topFlagBadge.test.tsx`, not literally `ProductChip.topFlag.test.tsx` — that name already exists (a distinct Task-14 test covering universal-flag rendering at lock time). Also updated the two `describe(...)` block labels for consistency.
  - Caffeine `value` field: dropped entirely, including removing it from the shared `ScanFlag` type (`shared/types/scan-flags.ts`) since nothing ever rendered it (`ScanFlagBadge` only reads `severity`/`title`/`detail`). Verified with a project-wide `tsc --noEmit` (0 errors) and a full grep for any reader.
  - Sodium copy: changed "Above the FSA guideline for salt." → "Above the FSA guideline for sodium." with an inline comment explaining the FSA's salt-denominated guidance is pre-converted to mg sodium (see `nutrition-flag-rules.ts`'s single-conversion-rule comment).
  - `partitionScanFlags` defensive default: added a `logger.warn` (not a render) on an unmodeled flag `kind`, distinct from the pre-existing intentional silent-drop for a gradeless `nutriscore` flag. Covered by a new test in `nutrition-detail-flags-utils.test.ts`.
  - Verified the `NutritionData.novaGroup`/`nutriScore` removal doesn't change the `POST /api/scanned-items` write path: `insertScannedItemSchema` (Zod, `createInsertSchema`, no `.passthrough()`) already silently stripped those fields since the `scannedItems` table has no such columns — confirmed no behavior change.
  - Filed `todos/P3-2026-07-24-nutrition-route-stale-nova-comment.md` (low severity, out of this todo's file scope) for a stale comment the researcher flagged in `server/routes/nutrition.ts` ("novaGroup and nutriScore are kept — they are displayed") that becomes misleading after this cleanup.
- Reviewed by `code-reviewer` + `mobile-reviewer` + `ai-reviewer`; one WARNING (raw `console.warn` → project's `logger.warn`, per precedent in `scan-screen-utils.ts`) fixed inline. All other findings: none.
