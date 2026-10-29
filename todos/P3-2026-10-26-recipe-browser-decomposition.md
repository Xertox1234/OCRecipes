---
title: "Move RecipeBrowserScreen's recipe card and filter bar into components"
status: in-progress
priority: low
created: 2026-10-26
updated: 2026-10-26
assignee:
labels: [deferred, maintainability, client]
github_issue:
---

# Move RecipeBrowserScreen's recipe card and filter bar into components

## Summary

Extract the local 230-line `UnifiedRecipeCard` and the ~200-line filter-chip bar out of `RecipeBrowserScreen.tsx` (1432 lines).

## Background

Audit finding L1. `client/screens/meal-plan/RecipeBrowserScreen.tsx:128-355` (`UnifiedRecipeCard`, `React.memo`, file-local) and `:853-1050` filter bar with its toggle handlers (`:713-736`). (The idea-card make flow was already extracted to `useMakeSuggestionFlow` in the audit PR.)

Deferred from the 2026-10-25 `/audit maintainability` run (user triage: the large refactors become todos, each its own PR with its own review). Discovery: `code-reviewer` with the maintainability-checklist lens; every cited line was re-read and grep-verified by the orchestrator before filing.

## Acceptance Criteria

- [ ] `client/components/meal-plan/UnifiedRecipeCard.tsx` and `RecipeFilterBar({ filters, onChange, activeFilterCount })` extracted
- [ ] Screen under ~1000 lines
- [ ] Behaviour unchanged: existing tests for the touched files pass without edits to their assertions (new tests may be added)
- [ ] No file in scope ends above 600 lines unless it started there and shrank

## Implementation Notes

RecipeBrowserScreen has many test files mocking hooks wholesale — run them all. Keep FlatList/SectionList render-item stability tests green.

## Scope Contract

- **Mechanisms to use:** extraction/move of existing code only — no new runtime behaviour
- **Files in scope:** `client/screens/meal-plan/RecipeBrowserScreen.tsx`, new `client/components/meal-plan/{UnifiedRecipeCard,RecipeFilterBar}.tsx`, `client/screens/meal-plan/__tests__/RecipeBrowserScreen*.test.tsx`
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None

## Risks

- Render-item stability (memo) regressions — the existing stability test covers it.

## Updates

### 2026-10-26

- Initial creation from the 2026-10-25 maintainability audit
