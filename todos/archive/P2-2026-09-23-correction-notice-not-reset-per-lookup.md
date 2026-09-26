---
title: "useNutritionLookup never resets correctionNotice or isPer100g per lookup — a stale serving-correction notice can carry into the next product"
status: done
priority: medium
created: 2026-09-23
updated: 2026-09-25
assignee:
labels: [deferred, audit, accessibility, code-quality]
github_issue:
---

# useNutritionLookup never resets correctionNotice or isPer100g per lookup — a stale serving-correction notice can carry into the next product

## Summary

`fetchBarcodeData`'s reset block resets every other per-lookup signal but never `correctionNotice` (set at :504/:726) or `isPer100g`. A re-lookup can show the previous product's correction notice. This is a known codified residual that no todo tracks.

## Background

Found by the 2026-09-23 front-end audit (read-only, 6 lenses + Context7 research). Finding ID(s): **M14** in `docs/audits/2026-09-23-frontend.md` (local-only, gitignored). Each claim below was re-read against the code at HEAD `3df8b4b3`; line numbers may drift.

- `client/hooks/useNutritionLookup.ts:125` (state), :401-438 (reset block), :504, :726 (sets); `isPer100g` is set only on success paths (:498/:591/:717/:808/:815/:840).
- Documented as a residual in `docs/solutions/conventions/mutual-exclusion-proven-per-call-site-can-co-occur-across-invocations-2026-08-06.md`, pinned by a characterization test in `client/screens/__tests__/NutritionDetailScreen.test.tsx`; the comment at `NutritionDetailScreen.tsx:392-407` calls it "out of this slice's scope".
- Research: `better-fix`. The double-announce premise is weak (`NoticeStack` is a single edge-guarded announcer), but the stale state itself is real. If two announcers remain after the fix, use `announceForAccessibilityWithOptions(..., { queue: true })`.

## Acceptance Criteria

- [x] `setCorrectionNotice(null)` and an `isPer100g` reset are added to the top-of-lookup reset block
- [x] The characterization test pinning the residual is updated to assert the fixed behavior
- [x] The solution doc and the NutritionDetailScreen comment are updated to say the residual is closed
- [x] Failing test written first (TDD), then the fix; the test fails on current `main` and passes after.

## Implementation Notes

Small, independent fix — land it before the useNutritionLookup atomic-state refactor.

## Scope Contract

- **Mechanisms to use:** existing project patterns cited above — nothing new beyond what the acceptance criteria name.
- **Files in scope:**
  - `client/hooks/useNutritionLookup.ts`
  - `client/screens/NutritionDetailScreen.tsx (comment only)`
  - `client/screens/__tests__/NutritionDetailScreen.test.tsx`
  - `docs/solutions/conventions/mutual-exclusion-proven-per-call-site-can-co-occur-across-invocations-2026-08-06.md`
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None

## Risks

- Confirm `isPer100g`'s correct default for each failure branch before resetting.

## Updates

### 2026-09-23

- Initial creation from the 2026-09-23 front-end audit (M14).

### 2026-09-25

- Implemented: `setCorrectionNotice(null)` and `setIsPer100g(false)` added to
  `fetchBarcodeData`'s per-lookup reset block in `client/hooks/useNutritionLookup.ts`.
  Two new hook-level tests in `client/hooks/__tests__/useNutritionLookup.test.ts`
  (out-of-contract, needed for AC #4 — `NutritionDetailScreen.test.tsx` mocks the
  hook wholesale and cannot exercise the reset) written first and confirmed RED on
  pre-fix code, then GREEN after the fix. Comments in `NutritionDetailScreen.tsx`
  and its test file updated to record the residual as closed (screen-level
  behavior unchanged — the fixture-driven characterization test still passes,
  now documented as defense-in-depth rather than a reachable production path).
  Solution doc extended with a closure note; general Rule left intact.
  Reviewed clean by `code-reviewer` and `mobile-reviewer` (no findings, 0 rounds).
