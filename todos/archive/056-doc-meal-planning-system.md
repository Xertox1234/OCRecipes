---
title: "Document meal planning system in project docs"
status: done
priority: medium
created: 2026-02-08
updated: 2026-02-08
assignee:
labels: [documentation, meal-planning]
---

# Document Meal Planning System

## Summary

The meal planning feature is entirely undocumented across all project docs. Explore the full feature and add documentation to ARCHITECTURE.md, API.md, FRONTEND.md, DATABASE.md, and CLAUDE.md.

## Background

The `feat/meal-planning-phase-1` branch added an extensive meal planning system that is not mentioned in any documentation. This includes new screens, database tables, API endpoints, and external service integrations.

## Acceptance Criteria

- [x] Document 5 screens (MealPlanHome, RecipeDetail, RecipeBrowser, RecipeCreate, RecipeImport) in FRONTEND.md
- [x] Document MealPlanStackNavigator in ARCHITECTURE.md navigation diagram
- [x] Document 3 DB tables (mealPlanRecipes, recipeIngredients, mealPlanItems) in ARCHITECTURE.md
- [x] Document ~12 API endpoints (/api/meal-plan/_, /api/meal-plan/recipes/_, /api/meal-plan/catalog/\*) in API.md
- [x] Document Spoonacular catalog integration in ARCHITECTURE.md
- [x] Document recipe import from URLs service in ARCHITECTURE.md
- [x] Add meal planning to CLAUDE.md overview and README.md

## Implementation Notes

Key files to explore:

- `client/navigation/MealPlanStackNavigator.tsx`
- `client/screens/MealPlanHomeScreen.tsx`, `RecipeDetailScreen.tsx`, `RecipeBrowserScreen.tsx`, `RecipeCreateScreen.tsx`, `RecipeImportScreen.tsx`
- `client/components/recipe-builder/` (7 subcomponents)
- `server/services/recipe-catalog.ts` (Spoonacular integration)
- `server/services/recipe-import.ts` (URL import with cheerio)
- `server/routes.ts` — search for meal-plan and recipe endpoints
- `shared/schema.ts` — mealPlanRecipes, recipeIngredients, mealPlanItems tables
