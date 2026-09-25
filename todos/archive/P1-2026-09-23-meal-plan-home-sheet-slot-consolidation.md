---
title: "MealPlanHomeScreen: collapse four hand-duplicated bottom-sheet slots (and their order-dependent back handlers) into one activeSheet union"
status: done
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

- [x] One `activeSheet: { kind, mealType } | null` replaces the four state atoms; one present/dismiss effect; ONE `useSheetBackHandler` call
- [x] The load-bearing-order comment block is deleted because there is nothing left to order
- [x] A shared `useSheetHostProps()` (or constant) supplies the host prop bundle to all 5 BottomSheetModal sites, with the a11y comment in one place
- [x] Top action buttons render from a config array
- [x] Existing MealPlanHomeScreen tests + Android back-handler tests stay green; add a test that back dismisses the open sheet for each kind
- [x] Failing test written first (TDD), then the fix; the test fails on current `main` and passes after.

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

### 2026-09-25

- Implemented. One `activeSheet: { kind, mealType } | null` union replaces the
  4 `xxxMealType` atoms; one present/dismiss `useEffect` (dismisses only the
  previously-active kind on a transition); ONE `useSheetBackHandler` call via
  a plain `activeSheetRef` reassigned only on open (mirroring the hook's own
  asymmetric `isOpenRef` bias) — `useSheetBackHandler.ts` was NOT modified.
  Extracted `client/hooks/useSheetHostProps.ts` (new) for the shared
  backdrop/background/handle-indicator + `accessible={false}` iOS a11y-fix
  bundle, reused across MealPlanHomeScreen's 4 sheets and
  RecipeBrowserScreen's 1 (host props only; its own back-handler wiring was
  untouched, preserving its distinct backdrop-opacity/press-behavior/handle
  visuals). Top action buttons now render from a `topActions` config array.
  TDD: rewrote the wiring-integrity test file's back-handler describe block
  to drive sheets open through real production callbacks rather than
  simulating a captured per-instance `onChange` (no longer possible once all
  4 sheets share one `onChange`); added a state-driven regression test for
  the menu -> destination-sheet handoff race (a late `onDismiss` from the
  closing menu must not clobber the just-opened destination sheet — the
  `closeSheet(kind)` helper is guarded on `prev?.kind === kind` for exactly
  this). Verified RED->GREEN empirically: checking out the pre-change
  `MealPlanHomeScreen.tsx` against the new test file produces exactly the
  expected failures (`registers exactly 1 hardwareBackPress listener`:
  expected 1, got 4; a knock-on failure on the "back press falls through"
  test from the old code's per-instance mount-time `dismiss()` calls), then
  passes 34/34 after restoring the new implementation.
  Reviewed by `code-reviewer` + `mobile-reviewer` (both: no blocking
  findings; two trivial SUGGESTIONs applied — a doc-comment file-extension
  typo, and a note on `useSheetBackHandler`'s `stateIsOpenRef` fallback now
  being load-bearing for this screen's shared-`onChange` multi-sheet case).
  Also included two small user-directed carry-over fixes from #1083's review
  in a separate commit: reworded 3 "VoiceOver/TalkBack" a11y-collapse
  comments (2 in `MealPlanHomeScreen.tsx`, 1 in its test file) to iOS-only
  per device-verified evidence, and fixed a `vi.hoisted` TDZ hazard in
  `docs/solutions/conventions/inline-vi-mock-globally-aliased-modules-2026-05-13.md`'s
  example snippet.
