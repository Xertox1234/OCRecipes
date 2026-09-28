---
title: "useNutritionLookup: replace 23 independent state atoms with one atomic per-lookup state and a pure lookupBarcode() outcome union"
status: done
priority: high
created: 2026-09-23
updated: 2026-09-28
assignee:
labels: [deferred, audit, maintainability]
github_issue:
---

# useNutritionLookup: replace 23 independent state atoms with one atomic per-lookup state and a pure lookupBarcode() outcome union

## Summary

`useNutritionLookup` (1028 lines) spreads each lookup's result over ~15 of its 23 `useState` atoms, mutated along many exit paths of a 392-line `fetchBarcodeData`. About 35 lines of comments exist only to keep "reset every atom on every exit" true, and there are three duplicated server→`NutritionData` mappers.

## Background

Found by the 2026-09-23 front-end audit (read-only, 6 lenses + Context7 research). Finding ID(s): **H8, L8** in `docs/audits/2026-09-23-frontend.md` (local-only, gitignored). Each claim below was re-read against the code at HEAD `3df8b4b3`; line numbers may drift.

- Atoms at `useNutritionLookup.ts:82-175`; `fetchBarcodeData` :401-793; reset-rationale comments :403-438; duplicated mappers :507-524, :546-563, :730-743; duplicated `ValidatedNutrition` literals :487-492 / :567-572.
- The file's history is full of "stale prior product" fixes, the bug class this shape invites; see also the codified residual `docs/solutions/conventions/mutual-exclusion-proven-per-call-site-can-co-occur-across-invocations-2026-08-06.md`.
- L8: `fetchBarcodeData` has no stale-response guard if `barcode` changes during an in-flight fetch. Currently latent (no reachable trigger found), but the new shape should close it: discard outcomes whose barcode ≠ current.
- Maintainability lens (the agent rated it Critical; the orchestrator rated it High because it is an opportunity rather than a user-facing defect). Proposed design from the audit follows.

## Acceptance Criteria

- [x] A pure `lookupBarcode(code, ocrText, signal): Promise<LookupOutcome>` returns a discriminated union (server-ok / server-ok-conflict / not-in-database / off-fallback / off-not-found / total-outage), unit-tested without React
- [x] Per-lookup result state is ONE object set atomically from the outcome; the reset-rationale comment block is deleted because the invariant holds by construction
- [x] One `toNutritionData(...)` mapper replaces the three copies
- [x] Out-of-order responses for a superseded barcode are discarded (test)
- [x] All existing useNutritionLookup / NutritionDetailScreen characterization tests stay green (update the correctionNotice pin if the correction-notice todo lands first)
- [x] Failing test written first (TDD), then the fix; the test fails on current `main` and passes after.

## Implementation Notes

Characterize current behavior first (existing tests + any gaps), then refactor behind them. Land the small `correctionNotice` reset todo first — it is a quick, independent fix.

## Scope Contract

- **Mechanisms to use:** existing project patterns cited above — nothing new beyond what the acceptance criteria name.
- **Files in scope:**
  - `client/hooks/useNutritionLookup.ts`
  - new pure module next to it (e.g. client/hooks/nutrition-lookup-outcome.ts)
  - `client/hooks/__tests__/`
  - `client/screens/__tests__/NutritionDetailScreen.test.tsx`
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- P2-2026-09-23-correction-notice-not-reset-per-lookup.md (land first)

## Risks

- Highest-churn client file (23 commits since June) — collision risk with parallel work; refactor in one focused PR.
- Allergen-safety flags flow through this hook — the outcome union must preserve the fail-safe "couldn't verify allergens" flag on every failure branch.

## Updates

### 2026-09-23

- Initial creation from the 2026-09-23 front-end audit (H8, L8).

### 2026-09-28

- Done via /todo-fast. New `client/hooks/nutrition-lookup-outcome.ts`: a total `lookupBarcode()` returning a six-variant `LookupOutcome`, one `toNutritionData`, and pure `beginLookup` / `lookupStateFromOutcome`; the hook holds every lookup-owned field in one `useState` object and the reset-rationale block is gone.
- Supersession is keyed on the effect run (AbortController checked at commit), not on barcode equality — a label retake re-fires for the SAME barcode, so "barcode ≠ current" alone would not discard it. Both cases tested; RED on the pre-refactor hook.
- Deviation from the Risks line, left for the user: `not-in-database` and `off-not-found` carry no "couldn't verify allergens" flag, exactly as before (no product ⇒ no flag). The union makes the flag REQUIRED on `off-fallback` and `total-outage` and absent on those two.
- Intended behaviour change: a non-success outcome resets `servingSizeGrams` instead of inheriting the prior product's (closes P3-2026-09-26-nutrition-lookup-serving-size-grams-not-reset, archived in the same PR).
- Out of contract, required: `scripts/todo-automerge-guard.sh` gains `nutrition-lookup-outcome` in SENSITIVE_OVERRIDE — the Bearer-header construction moved there from `useNutritionLookup` (already listed), and the guard's drift test failed on the unguarded file.
