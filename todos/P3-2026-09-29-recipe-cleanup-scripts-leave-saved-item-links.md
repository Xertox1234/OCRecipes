---
title: "Recipe cleanup scripts leave linked Saved Items rows behind"
status: in-progress
priority: low
created: 2026-09-29
updated: 2026-09-29
assignee:
labels: [deferred, server]
github_issue:
---

# Recipe cleanup scripts leave linked Saved Items rows behind

## Summary

PR #1165 links `saved_items` rows to real recipes (`recipe_id` + `recipe_type`, no FK) and clears
them in the app's two recipe delete paths. Three maintenance scripts delete recipes directly and
don't clear the link, so a Saved Items row could point at a recipe that no longer exists.

## Background

Server-reviewer note on #1165 @ `25764b86` (not filed as a finding; one-review-pass rule sends
follow-ups here). The scripts target seed/junk recipes, so a real user's linked recipe is unlikely
to be hit: catalog saves pass a content quality gate and chat saves are private user recipes. A
dangling row would open a "not found" recipe when tapped.

## Acceptance Criteria

- [ ] Each script below also deletes `saved_items` rows whose `(recipe_type, recipe_id)` match the
      recipes it deletes, in the same transaction/batch.
- [ ] A test (or a dry-run count) shows no `saved_items` row is left pointing at a deleted recipe.

## Implementation Notes

- `server/scripts/cleanup-seed-recipes.ts` (community, `recipe_type = 'community'`)
- `scripts/cleanup-junk-recipes.ts` (community)
- `scripts/cleanup-junk-mealplan-recipes.ts` (`recipe_type = 'mealPlan'`)
- Mirror the existing junction cleanup in `server/storage/community-recipes.ts`
  (`deleteCommunityRecipe`) and `server/storage/meal-plan-recipes-crud.ts` (`deleteMealPlanRecipe`).
