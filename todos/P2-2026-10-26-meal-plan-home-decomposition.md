---
title: "Move MealPlanHomeScreen's row components and sheet wiring out of the screen"
status: in-progress
priority: medium
created: 2026-10-26
updated: 2026-10-26
assignee:
labels: [deferred, maintainability, client]
github_issue:
---

# Move MealPlanHomeScreen's row components and sheet wiring out of the screen

## Summary

`MealPlanHomeScreen.tsx` is 1933 lines; move its row components into components and its sheet orchestration into a hook.

## Background

Audit finding M5. ~450 lines of memoized rows (`DateStripItem :165`, exported `MealSlotItem :232`, `MealSlotSection :391` — imported only by the screen's own tests) and ~400 lines of sheet orchestration (`activeSheet`, refs table, present/dismiss effect, back handler, per-sheet children) live in the screen. The four-sheet consolidation itself was already done (2026-09-23).

Deferred from the 2026-10-25 `/audit maintainability` run (user triage: the large refactors become todos, each its own PR with its own review). Discovery: `code-reviewer` with the maintainability-checklist lens; every cited line was re-read and grep-verified by the orchestrator before filing.

## Acceptance Criteria

- [ ] Rows move to `client/components/meal-plan/MealSlotSection.tsx` and `DateStrip.tsx` (screen re-exports for the existing tests, or tests import the new path)
- [ ] `useMealPlanSheets()` owns the sheet state machine, refs, effect, back handler and the gorhom-ordering comments, with its own tests
- [ ] Screen under ~1100 lines
- [ ] Behaviour unchanged: existing tests for the touched files pass without edits to their assertions (new tests may be added)
- [ ] No file in scope ends above 600 lines unless it started there and shrank

## Implementation Notes

Keep React Compiler coverage: run `node scripts/check-react-compiler-bailouts.js`. The gorhom present/dismiss ordering comments are load-bearing — move them verbatim.

## Scope Contract

- **Mechanisms to use:** extraction/move of existing code only — no new runtime behaviour
- **Files in scope:** `client/screens/meal-plan/MealPlanHomeScreen.tsx`, new `client/components/meal-plan/{MealSlotSection,DateStrip}.tsx`, new `client/hooks/useMealPlanSheets.ts`, `client/screens/meal-plan/__tests__/MealPlanHomeScreen*.test.tsx`
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None

## Risks

- Android back-handler / sheet ordering regressions only show on device — owner device check after merge.

## Updates

### 2026-10-26

- Initial creation from the 2026-10-25 maintainability audit
