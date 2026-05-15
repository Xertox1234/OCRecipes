---
title: "Extract business logic from cooking route into service"
status: done
priority: low
created: 2026-03-27
updated: 2026-03-27
assignee:
labels: [architecture, audit-2026-03-27-full]
audit_id: L6
---

# Extract business logic from cooking route into service

## Summary

`server/routes/cooking.ts` is 925 lines with embedded in-memory session management, direct OpenAI Vision API calls, nutrition calculation logic, and allergen detection. Most should be in `server/services/cooking-session.ts`.

## Acceptance Criteria

- [x] OpenAI Vision calls extracted to a service
- [x] Nutrition calculation logic extracted to a service
- [x] Session management uses the generic session store factory (depends on M8/todo-014)
- [x] Route file reduced to HTTP handling only
- [x] Existing tests pass

## Implementation Notes

- Large refactor — consider doing incrementally

## Dependencies

- todo-014 (generic session store factory)

## Risks

- Large refactor surface area

## Updates

### 2026-03-28

- Extracted `analyzeIngredientPhoto` + `IngredientAnalysisError` to `server/services/cooking-session.ts`
- Extracted `calculateSessionNutrition` + `calculateSessionMacros` to `server/services/cooking-session.ts`
- Session store already uses `createSessionStore` factory (todo-014 resolved)
- Route reduced from 875 → 590 lines, now HTTP handling only
- All 43 cooking tests + 3144 full suite tests pass
- Updated test mocks to use `vi.importActual` partial mock strategy

### 2026-03-27

- Created from full audit finding L6
