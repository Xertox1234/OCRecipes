---
title: "Make "add suggestion to plan" one server call instead of two"
status: done
priority: medium
created: 2026-10-26
updated: 2026-10-26
assignee:
labels: [deferred, maintainability, server, client]
github_issue:
---

# Make "add suggestion to plan" one server call instead of two

## Summary

`handleSelectSuggestion` creates a recipe and then adds it to the plan as two client calls, patched by a retry-reuse ref; make it one transactional server call.

## Background

Audit finding M6. `client/screens/meal-plan/MealPlanHomeScreen.tsx:1186-1250`: `createRecipe` then `addMealPlanItem`. If the second call fails, a recipe exists that is on no plan; `createdSuggestionRecipeRef` reuses it on retry only if the user retries the same title in the same session.

Deferred from the 2026-10-25 `/audit maintainability` run (user triage: the large refactors become todos, each its own PR with its own review). Discovery: `code-reviewer` with the maintainability-checklist lens; every cited line was re-read and grep-verified by the orchestrator before filing.

## Acceptance Criteria

- [ ] One endpoint (e.g. meal-plan item create accepting an inline recipe payload) creates both rows in one `db.transaction`
- [ ] The client calls it once; `createdSuggestionRecipeRef`, the pending-title comparison and the double invalidation are deleted
- [ ] IDOR: the new/extended route scopes every write to `req.userId` with a wrong-user test
- [ ] Route test pins rollback: a failing plan-item insert leaves no recipe row
- [ ] Behaviour unchanged: existing tests for the touched files pass without edits to their assertions (new tests may be added)
- [ ] No file in scope ends above 600 lines unless it started there and shrank

## Implementation Notes

Prefer extending the existing meal-plan item route over a new path if the payload stays clean. Zod-validate the inline recipe with the existing recipe create schema.

## Scope Contract

- **Mechanisms to use:** extraction/move of existing code only — no new runtime behaviour
- **Files in scope:** `server/routes/meal-plan*.ts`, `server/storage/meal-plan*.ts`, `client/screens/meal-plan/MealPlanHomeScreen.tsx`, the meal-plan hooks, their `__tests__`
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None

## Risks

- New write path → needs `server-reviewer` + `security-auditor`.
- Client and server must ship together (OTA + deploy order).

## Updates

### 2026-10-26

- Initial creation from the 2026-10-25 maintainability audit

### 2026-10-27

- Done: POST /api/meal-plan/items accepts an inline `recipe` and creates recipe + ingredients + plan item via `createMealPlanFromSuggestions` (one transaction); client sends one call; ref and double invalidation removed.
- Out of contract: new `server/routes/_meal-plan-schemas.ts` (schemas + date validator moved out so meal-plan.ts ends at 777 < its 808 start, AC #6).
- The plan-add "retry reuses the recipe" test pinned the retired ref behaviour and was rewritten.
