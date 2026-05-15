---
title: "Implement deep linking for key screens"
status: done
priority: low
created: 2026-03-24
updated: 2026-03-24
assignee:
labels: [navigation, feature]
---

# Implement Deep Linking for Key Screens

## Summary

Wire a `linking` configuration into `NavigationContainer` so the app can handle `ocrecipes://` URLs and universal links for sharing recipes and handling push notification deep links.

## Background

`app.json` already defines `scheme: "ocrecipes"` but no `linking` config is wired to `NavigationContainer`. Links like `ocrecipes://recipe/123` or universal links won't navigate to the correct screen.

## Acceptance Criteria

- [x] Define `linking` config object with path mappings for key screens
- [x] Pass `linking` to `NavigationContainer` in `App.tsx`
- [x] Support at minimum: RecipeDetail, NutritionDetail, Chat screens
- [x] Handle missing/invalid IDs gracefully (show error or redirect to home)
- [x] Test with `npx uri-scheme open ocrecipes://recipe/123 --ios`

## Implementation Notes

- React Navigation deep linking docs: define `linking.prefixes` and `linking.config.screens`
- Key paths:
  - `ocrecipes://recipe/:id` → RecipeDetail (in MealPlanStack)
  - `ocrecipes://nutrition/:barcode` → NutritionDetail (root modal)
  - `ocrecipes://chat/:conversationId` → Chat (in ChatStack)
  - `ocrecipes://scan` → Scan (root modal)
- Consider universal links (`https://ocrecipes.app/recipe/123`) for sharing outside the app
- Auth guard: deep links should queue if user is not authenticated, then navigate after login

## Dependencies

- None — React Navigation linking is built-in

## Updates

### 2026-03-24

- Created from full frontend usability review
- Implemented: linking config (`client/navigation/linking.ts`), wired into `App.tsx`, tests added
- Supported paths: `recipe/:recipeId`, `nutrition/:barcode`, `chat/:conversationId`, `scan`
- Invalid IDs handled by existing screen-level error states (TanStack Query error guards)
