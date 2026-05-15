---
title: "P2: Consolidate duplicate type definitions into shared/types"
status: backlog
priority: medium
created: 2026-02-06
updated: 2026-02-06
assignee:
labels: [typescript, code-quality, p2, meal-plan]
---

# P2: Consolidate duplicate type definitions into shared/types

## Summary

Several types are defined redundantly across client and server files. Consolidate into `shared/types/` to prevent drift.

## Background

- `MealPlanItemWithRelations` — defined in `client/hooks/useMealPlan.ts:5-8` AND `client/screens/meal-plan/MealPlanHomeScreen.tsx:71-74` AND implicitly in `server/storage.ts`
- `CatalogSearchResult`, `CatalogSearchResponse`, `CatalogSearchParams` — defined in `client/hooks/useMealPlanRecipes.ts:9-31` AND `server/services/recipe-catalog.ts:70-87`

## Acceptance Criteria

- [ ] Create `shared/types/meal-plan.ts` with `MealPlanItemWithRelations` type
- [ ] Move catalog types (`CatalogSearchResult`, `CatalogSearchResponse`, `CatalogSearchParams`) to `shared/types/recipe-catalog.ts`
- [ ] Update all imports in client and server to use shared types
- [ ] Remove duplicate definitions
- [ ] No TypeScript errors (`npm run check:types`)

## Implementation Notes

Follow the existing pattern of `shared/types/recipe-import.ts` which already shares types between client and server.

## Dependencies

- None

## Updates

### 2026-02-06

- Created from multi-agent code review of `feat/meal-planning-phase-1`
