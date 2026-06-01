---
title: "Test quality round 2 — 5 tautological test files + 1 unmocked fire-and-forget"
status: backlog
priority: medium
created: 2026-05-31
updated: 2026-05-31
assignee:
labels: [deferred, testing]
github_issue:
---

# Test quality round 2

## Summary

Five test files reimplement production logic inline and never execute the real code under test (`docs/rules/testing.md` line 12), plus one route test fires an un-mocked fire-and-forget service (line 11) causing cross-file flakiness. Same class as the merged `tautological-idor-tests` todo (PRs #294/#309), new files.

## Background

Found in the 2026-05-31 code-quality re-run (H1, H2, M7, M8, M9, M10). A test that re-implements the logic it claims to verify gives false CI confidence — the real code can regress with the suite still green.

## Acceptance Criteria

- [ ] `client/camera/hooks/__tests__/useCamera.test.ts` (H1) — file has ZERO imports; reimplements `handleBarcodeScanned` inline. Import and exercise the real `useCamera` hook (`useCamera.ts:72-127`), or delete if covered elsewhere
- [ ] `client/context/__tests__/OnboardingContext.test.ts` (H2) — never imports the context; re-declares type/defaults, reimplements `updateData`/`nextStep`/`prevStep`, hardcodes `totalSteps=8`. Exercise the real provider/hook
- [ ] `client/context/__tests__/PremiumContext.test.ts` (M7) — keep the legit `TIER_FEATURES` assertions; replace the reimplemented tier/`isPremium` derivation (lines 11-46) with the real provider value
- [ ] `server/__tests__/routes.test.ts:372-404` (M8) — "Meal Plan Date Range Validation" replicates the route's `validateDateRange`. Extract the real validator from `meal-plan.ts:~371` and test that. (Distinct file from the open `2026-05-31-storage-test-date-range-tautological.md` todo)
- [ ] `client/screens/__tests__/ScanScreenConfirmOverlay-utils.test.ts:191-205` (M9) — `wouldProceed` mirrors the EXPORTED `canLog()` (already imported, line 73 of -utils.ts) and not faithfully (adds a `!!card` guard). Call the real `canLog()`
- [ ] `server/routes/__tests__/chat.test.ts` (M10) — add `vi.mock("../../services/coach-pro-chat")`; the route fires `fireAndForget(tryArchiveNotebook)` (`chat.ts:247-249`) which currently runs the real service post-await, mutating shared mocks → flakiness
- [ ] No net reduction in REAL coverage; all tests pass

## Implementation Notes

- For M8/M9: the proper fix is extract-and-import or call-the-export, NOT reimplement. M8 needs the route to expose the validator (extract it).
- For M10: mirror how sibling route tests mock every fire-and-forget service (see the recipes.test.ts mock factory pattern).

## Risks

- Medium — rewriting tests risks losing coverage signal if done carelessly. For each, confirm real coverage exists (or is added) before deleting a tautological block.

## Updates

### 2026-05-31

- Filed from the 2026-05-31 code-quality re-run, manifest H1, H2, M7, M8, M9, M10.
