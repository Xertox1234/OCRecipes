---
title: "RecipeBrowserScreen: replace 9 fragmented filter atoms with one filters object and a single DEFAULT_FILTERS constant"
status: done
priority: medium
created: 2026-09-23
updated: 2026-09-23
assignee:
labels: [deferred, audit, maintainability]
github_issue:
---

# RecipeBrowserScreen: replace 9 fragmented filter atoms with one filters object and a single DEFAULT_FILTERS constant

## Summary

RecipeBrowserScreen keeps 9 filter `useState` atoms that are re-listed in three separate derivations, and writes the default-filters literal three times. One `filters` object plus `DEFAULT_FILTERS` would delete about 60–70 lines.

## Background

Found by the 2026-09-23 front-end audit (read-only, 6 lenses + Context7 research). Finding ID(s): **M20** in `docs/audits/2026-09-23-frontend.md` (local-only, gitignored). Each claim below was re-read against the code at HEAD `3df8b4b3`; line numbers may drift.

- State :340-357, :369; derivations: `searchParams` :396-423, `activeFilterCount` :439-449, `showDiscovery` :454-463; `handleClearFilters` :624-640; default literal at :346-352, :634-639, :1076-1082.
- Maintainability lens (opportunity, not defect).

## Acceptance Criteria

- [x] One `filters` state object + `DEFAULT_FILTERS` used at init, clear, and sheet reset
- [x] `activeFilterCount` and `showDiscovery` derive from `filters`
- [x] recipe-browser-utils tests updated; screen behavior unchanged
- [x] Failing test written first (TDD), then the fix; the test fails on current `main` and passes after.

## Implementation Notes

Do after the unstable-mutation-deps todo to avoid conflicting edits in the same callbacks.

## Scope Contract

- **Mechanisms to use:** existing project patterns cited above — nothing new beyond what the acceptance criteria name.
- **Files in scope:**
  - `client/screens/meal-plan/RecipeBrowserScreen.tsx`
  - `client/screens/meal-plan/recipe-browser-utils.ts`
  - matching `__tests__/`
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None

## Risks

- None significant.

## Updates

### 2026-09-23

- Initial creation from the 2026-09-23 front-end audit (M20).

### 2026-09-25

- Implemented (`3d4c2336`). Consolidated activeCuisine/activeDiet/activeDifficulty/
  curatedOnly/safeForMe/pantryMode/advancedFilters (7 of the 9 named atoms) into one
  `filters: RecipeFilters` object with a nested `advanced: SearchFilters` sub-object,
  plus a single `DEFAULT_FILTERS` constant in `recipe-browser-utils.ts` used at init,
  `handleClearFilters`, and the advanced sheet's own `onReset`. `searchText`/
  `debouncedQuery` were deliberately kept as separate atoms — folding them into the
  same object would make `searchParams`/`showDiscovery` recompute (and `useRecipeSearch`
  re-key) on every keystroke instead of only after the 300ms debounce, risking extra
  calls against the 20/min `/api/recipes/search` budget. The nested `advanced` shape
  (rather than one flat object) matters: it keeps `SearchFilterSheet`'s existing
  `SearchFilters` contract untouched and guarantees the sheet's reset can never clear
  chip-row filters (cuisine/diet/difficulty/curatedOnly/safeForMe/pantryMode) — a flat
  shape would have let `setFilters(DEFAULT_FILTERS)` wipe the whole screen from the
  sheet's reset button, a behavior change the AC forbids.
- Extracted the active-filter-count derivation into a new pure `computeActiveFilterCount`
  in `recipe-browser-utils.ts` (existing `client/*-utils.ts` pure-function pattern),
  covered by new tests written TDD-first (red — `computeActiveFilterCount is not a
function` — before the export existed; green after). Pins the pre-existing
  behavior exactly: only the advanced sheet's 5 fields plus curatedOnly/safeForMe
  count toward the badge; chip-row filters (cuisine/diet/difficulty/pantryMode) do not.
- Full suite green (545 files / 8691 tests), `tsc --noEmit` clean, lint clean (2
  pre-existing warnings in unrelated files). Two-reviewer pass (code-reviewer +
  mobile-reviewer) returned "No findings." — no CRITICAL/WARNING/SUGGESTION.
- Codified: extended `docs/solutions/design-patterns/lifted-filter-state-presentational-sheet-2026-05-13.md`
  with the nested-sub-object rule for when a parent owns filter state outside the sheet.
