---
title: "Make lookupCNF report 'unavailable' when the CNF food lists failed to load"
status: backlog
priority: low
created: 2026-10-30
updated: 2026-10-30
assignee:
labels: [deferred, api]
github_issue:
---

# Make lookupCNF report "unavailable" when the CNF food lists failed to load

## Summary

`lookupCNF` still returns `NutritionData | null`. When `ensureCNFFoods` fails (a non-OK response, a thrown fetch, or schema drift), CNF is skipped, and that looks the same as a miss. If USDA and API Ninjas then answer "no match", `fetchNutritionFromSources` returns `not-found` → 404, even though the primary source was down.

## Background

Reliability audit 2026-10-30, finding R09, named CNF, USDA and API Ninjas. The server-network PR moved USDA and API Ninjas to the three-way `NutritionLookupOutcome` (`found / not-found / unavailable`) but left CNF on `T | null`. Impact is low: CNF failing still falls through to USDA, so the user only gets a wrong 404 when all three miss. Found during Phase 8 codification. See `docs/solutions/logic-errors/upstream-outage-collapsed-into-not-found-2026-10-30.md`.

## Acceptance Criteria

- [ ] A failing test: the CNF list load fails, USDA and API Ninjas both return `not-found` → `lookupNutritionOutcome` returns `unavailable`
- [ ] `lookupCNF` (or a new outcome-returning sibling) reports `unavailable` when the food lists are not loaded because the load failed, and `not-found` for a genuine no-match
- [ ] The failed list load is retried on a later call. Today `cnfFetchPromise` resets, so check that this still holds
- [ ] `lookupNutrition` keeps its `NutritionData | null` contract

## Implementation Notes

- `server/services/cnf-lookup.ts` — `ensureCNFFoods`, `lookupCNF`. Check `res.ok` before `.json()`
- `server/services/nutrition-lookup.ts` — `fetchNutritionFromSources`, so that `anyUnavailable` also covers CNF
- Tests: `server/services/__tests__/nutrition-lookup.test.ts`, and the CNF tests if separate

## Scope Contract

- **Mechanisms to use:** the existing `NutritionLookupOutcome` type — nothing new
- **Files in scope:** `server/services/cnf-lookup.ts`, `server/services/nutrition-lookup.ts`, their `__tests__`
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- The server-network reliability PR (introduces `NutritionLookupOutcome`)

## Risks

- `lookupCNF` has other callers. Check with LSP findReferences before changing its signature, or add a sibling instead

## Updates

### 2026-10-30

- Initial creation (deferred from reliability audit Phase 8)
