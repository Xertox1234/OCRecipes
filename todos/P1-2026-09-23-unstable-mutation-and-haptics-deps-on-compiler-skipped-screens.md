---
title: "RecipeBrowser, MealPlanHome and Home pass whole useMutation/useHaptics objects as callback deps on compiler-skipped screens — list rows re-render every render"
status: backlog
priority: high
created: 2026-09-23
updated: 2026-09-23
assignee:
labels: [deferred, audit, performance]
github_issue:
---

# RecipeBrowser, MealPlanHome and Home pass whole useMutation/useHaptics objects as callback deps on compiler-skipped screens — list rows re-render every render

## Summary

Three hot screens are skipped by the React Compiler and use referentially unstable objects (a whole `useMutation` result, or the `useHaptics()` object) in `useCallback` deps. Their memoized list rows re-render on every parent render — on RecipeBrowser, on every search keystroke.

## Background

Found by the 2026-09-23 front-end audit (read-only, 6 lenses + Context7 research). Finding ID(s): **H4, M2, M3** in `docs/audits/2026-09-23-frontend.md` (local-only, gitignored). Each claim below was re-read against the code at HEAD `3df8b4b3`; line numbers may drift.

- H4 `RecipeBrowserScreen.tsx:425, 538-584, 643-669`: `addItemMutation` in `handleRecipePress` deps → `renderItem` recreated per keystroke (`handleSearchChange` sets state synchronously; only the query is debounced) → every visible `UnifiedRecipeCard` re-renders. Bailout: try/finally in `handleRecipePress`.
- M2 `MealPlanHomeScreen.tsx`: `removeMutation`, `reorderMutation`, `confirmMutation`, `createRecipeMutation`, `addItemMutation` used whole in deps (:580, :626-627, :754-777, :985-1044) → into memo'd `MealSlotSection`/`MealSlotItem`. Bailout: `eslint-disable-next-line react-hooks/exhaustive-deps` at :1096.
- M3 `HomeScreen.tsx:229-318, 377-384`: `haptics` object (fresh literal every render, `useHaptics.ts:78-88`) as a dep in 4 callbacks passed to carousels/rows. Bailout: eslint-disable on `glideRowToTop`.
- Research (TanStack 5.x render-optimizations + eslint `no-unstable-deps`): the top-level `useMutation` result is NOT referentially stable; `mutate`/`mutateAsync` are. `confirmed`.

## Acceptance Criteria

- [ ] Each listed callback depends on destructured `mutate`/`mutateAsync` (or `haptics.impact`/`.notification`/`.selection`), never the whole object
- [ ] Test per screen: re-rendering the parent does not change the identity of the callback/renderItem passed to the list rows
- [ ] Optionally (decide in implementation): make `useHaptics` return a memoized object so every consumer is fixed at the source — only if it doesn't break its tests
- [ ] Failing test written first (TDD), then the fix; the test fails on current `main` and passes after.

## Implementation Notes

Pattern already used correctly in CoachChat.tsx (comment at :105-107) and HistoryScreen.tsx. Do not remove the eslint-disable / try-finally here — getting compilation back is the compiler-visibility todo's job.

## Scope Contract

- **Mechanisms to use:** existing project patterns cited above — nothing new beyond what the acceptance criteria name.
- **Files in scope:**
  - `client/screens/meal-plan/RecipeBrowserScreen.tsx`
  - `client/screens/meal-plan/MealPlanHomeScreen.tsx`
  - `client/screens/HomeScreen.tsx`
  - `client/hooks/useHaptics.ts (only if fixing at source)`
  - matching `__tests__/`
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None

## Risks

- MealPlanHomeScreen overlaps the a11y and sheet-consolidation todos — sequence them.

## Updates

### 2026-09-23

- Initial creation from the 2026-09-23 front-end audit (H4, M2, M3).
