---
title: "RecipeBrowserScreen: replace 9 fragmented filter atoms with one filters object and a single DEFAULT_FILTERS constant"
status: backlog
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

- [ ] One `filters` state object + `DEFAULT_FILTERS` used at init, clear, and sheet reset
- [ ] `activeFilterCount` and `showDiscovery` derive from `filters`
- [ ] recipe-browser-utils tests updated; screen behavior unchanged
- [ ] Failing test written first (TDD), then the fix; the test fails on current `main` and passes after.

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
