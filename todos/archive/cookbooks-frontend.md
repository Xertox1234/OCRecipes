---
title: "Complete cookbook browsing and organization UI"
status: complete
priority: medium
created: 2026-03-20
updated: 2026-03-20
assignee:
labels: [ui, recipes, cookbooks]
---

# Complete Cookbook Browsing and Organization UI

## Summary

Cookbook backend CRUD is fully implemented (create, read, update, delete, add/remove recipes) but the frontend only has a creation screen. Users cannot browse, view, or organize recipes within their cookbooks.

## Background

`CookbookCreateScreen` exists for creating cookbooks with name and description. Backend routes in `cookbooks.ts` support full CRUD plus adding/removing recipes (with polymorphic FK supporting both personal and community recipes). The missing piece is the UI to actually use cookbooks after creating them.

## Acceptance Criteria

- [ ] Users can view a list of their cookbooks
- [ ] Users can open a cookbook and see its recipes
- [ ] Users can add recipes to a cookbook from recipe detail screens
- [ ] Users can remove recipes from a cookbook
- [ ] Users can edit cookbook name/description
- [ ] Users can delete a cookbook
- [ ] Empty state for cookbooks with no recipes

## Implementation Notes

- Backend routes already exist: `GET /api/cookbooks`, `GET /api/cookbooks/:id`, `PATCH /api/cookbooks/:id`, `DELETE /api/cookbooks/:id`, `POST /api/cookbooks/:id/recipes`, `DELETE /api/cookbooks/:id/recipes/:recipeId`
- Polymorphic recipe support: cookbooks hold both `mealPlanRecipes` and `communityRecipes` via `recipeType` discriminator
- Consider adding "Save to Cookbook" action on `RecipeDetailScreen`
- Cookbook list could live in the Plan tab or be accessible from recipe browsing

## Dependencies

- None — backend is complete

## Risks

- Design decision needed: where do cookbooks live in the navigation hierarchy?
- Polymorphic recipe display may need careful handling (different data shapes)

## Updates

### 2026-03-20

- Initial creation from feature audit
