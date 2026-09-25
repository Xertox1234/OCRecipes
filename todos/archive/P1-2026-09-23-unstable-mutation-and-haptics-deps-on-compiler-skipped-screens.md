---
title: "RecipeBrowser, MealPlanHome and Home pass whole useMutation/useHaptics objects as callback deps on compiler-skipped screens — list rows re-render every render"
status: done
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

- [x] Each listed callback depends on destructured `mutate`/`mutateAsync` (or `haptics.impact`/`.notification`/`.selection`), never the whole object
- [x] Test per screen: re-rendering the parent does not change the identity of the callback/renderItem passed to the list rows
- [x] Optionally (decide in implementation): make `useHaptics` return a memoized object so every consumer is fixed at the source — only if it doesn't break its tests
- [x] Failing test written first (TDD), then the fix; the test fails on current `main` and passes after.

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

### 2026-09-25

- Implemented: destructured `mutateAsync`/`mutate` (never the whole `useMutation()` object) in
  RecipeBrowserScreen's `handleRecipePress` (H4) and MealPlanHomeScreen's `handleRemoveItem`/
  `handleReorder`/`handleConfirmItem`/`handleSelectSuggestion` (M2); destructured `impact`/
  `notification` (never the whole `useHaptics()` object) in HomeScreen's `handleRefresh`/
  `handleActionPress`/`handleDrawerToggle`/`handleCalorieTap` (M3). Also memoized `useHaptics()`'s
  own return object (`useMemo` over its three already-`useCallback`-stable inner functions) — AC #3,
  taken since it was low-risk (existing tests assert behavior, not identity) and hardens every other
  whole-`haptics`-object consumer in the codebase at the source, without touching those files.
- A TDD-red test per screen proves the fix: RecipeBrowserScreen asserts `renderItem`'s identity
  survives a search keystroke; HomeScreen asserts `onCalorieTap`/`onRefresh`/`onActionPress` survive
  an unrelated re-render; MealPlanHomeScreen asserts a mocked `DraggableList`'s captured props object
  is the exact same reference across an unrelated section's expand/collapse — proof `MealSlotSection`'s
  own `React.memo` actually bails, not merely that individual callback fields are stable (the
  "denominator" here is inverted from a plain FlatList/SectionList capture: the props object staying
  identical IS the pass condition, since the capture point sits inside the memoized parent).
- Scope decision: MealPlanHomeScreen's `handleSuggest`/`handleAddItem`/`handleToggleSection` and
  RecipeBrowserScreen's other haptics-using callbacks still list the whole `haptics` object — not
  touched, since H4/M2's named findings are the mutation objects only (M3/HomeScreen is the only
  finding that names `haptics` itself), and AC #3's memoization makes that whole-object dependency
  stable regardless. Reviewed by `code-reviewer` + `mobile-reviewer`: no blocking findings.
