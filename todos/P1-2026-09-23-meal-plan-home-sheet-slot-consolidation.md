---
title: "MealPlanHomeScreen: collapse four hand-duplicated bottom-sheet slots (and their order-dependent back handlers) into one activeSheet union"
status: backlog
priority: high
created: 2026-09-23
updated: 2026-09-23
assignee:
labels: [deferred, audit, maintainability]
github_issue:
---

# MealPlanHomeScreen: collapse four hand-duplicated bottom-sheet slots (and their order-dependent back handlers) into one activeSheet union

## Summary

MealPlanHomeScreen (1700 lines) repeats a five-part sheet setup four times, and Android back only works because four `useSheetBackHandler` calls stay in a documented load-bearing order. One `activeSheet` state removes the ordering hazard along with about 130 lines.

## Background

Found by the 2026-09-23 front-end audit (read-only, 6 lenses + Context7 research). Finding ID(s): **H9, M23, M24** in `docs/audits/2026-09-23-frontend.md` (local-only, gitignored). Each claim below was re-read against the code at HEAD `3df8b4b3`; line numbers may drift.

- Four slots: state (:566-574), present/dismiss effects (:844-874), dismiss callbacks (:810-842), back handlers (:906-921, ordering hazard documented at :886-905), memoized children (:1113-1197), `<BottomSheetModal>` blocks (:1455-1546).
- `BottomSheetModal` instances must stay declared in the screen (comment :509-513), so the fix is table-driven props, not a child `<SheetHost>`.
- M23: the host prop bundle (backdropComponent/backgroundStyle/handleIndicatorStyle + `accessible={false}` + the iOS a11y-collapse comment, `docs/solutions/logic-errors/gorhom-bottomsheetmodal-collapses-a11y-subtree-on-ios-2026-09-05.md`) is copy-pasted 4× here and 1× in `RecipeBrowserScreen.tsx:1046-1069`.
- M24: the top action buttons (:1251-1337) are 4 near-identical Pressables; `client/components/home/action-config.ts` already shows the data-driven pattern.

## Acceptance Criteria

- [ ] One `activeSheet: { kind, mealType } | null` replaces the four state atoms; one present/dismiss effect; ONE `useSheetBackHandler` call
- [ ] The load-bearing-order comment block is deleted because there is nothing left to order
- [ ] A shared `useSheetHostProps()` (or constant) supplies the host prop bundle to all 5 BottomSheetModal sites, with the a11y comment in one place
- [ ] Top action buttons render from a config array
- [ ] Existing MealPlanHomeScreen tests + Android back-handler tests stay green; add a test that back dismisses the open sheet for each kind
- [ ] Failing test written first (TDD), then the fix; the test fails on current `main` and passes after.

## Implementation Notes

Keep the menu → destination two-step handoff (InteractionManager) behavior identical.

## Scope Contract

- **Mechanisms to use:** existing project patterns cited above — nothing new beyond what the acceptance criteria name.
- **Files in scope:**
  - `client/screens/meal-plan/MealPlanHomeScreen.tsx`
  - `client/screens/meal-plan/RecipeBrowserScreen.tsx (host props only)`
  - `client/hooks/useSheetBackHandler.ts (read-only unless required)`
  - a new small hook file for host props
  - matching `__tests__/`
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- Coordinate with: meal-plan-nested-buttons, unstable-mutation-deps, error-rendered-as-empty todos (same file)

## Risks

- Largest client screen, touched by 3 other audit todos — do this one LAST among the MealPlanHome todos, or first and rebase the others.

## Updates

### 2026-09-23

- Initial creation from the 2026-09-23 front-end audit (H9, M23, M24).
