---
title: "Re-add 'Safe for me' allergen filter to recipe search"
status: done
priority: medium
created: 2026-05-16
updated: 2026-05-16
assignee:
labels: [deferred, api]
github_issue:
---

# Re-add 'Safe for me' allergen filter to recipe search

## Summary

`RecipeBrowserScreen` had a "Safe for me" allergen filter that was removed — only a `// TODO: Re-add ... once search service supports it` comment remains. The client state variable and UI surface no longer exist.

## Background

Surfaced by the 2026-05-16 unfinished-features audit (finding M3, product-completeness). Deferred from the fix phase because it requires backend feature work: the local recipe search service (`server/services/recipe-search.ts`) has no allergen-filtering capability — it filters by cuisine, diet, difficulty, and `source`, but not by recipe allergen content.

The Spoonacular catalog path (`server/routes/recipe-catalog.ts`) already maps OCRecipes allergen IDs to Spoonacular intolerance params, but the local DB search does not.

## Acceptance Criteria

- [ ] Add allergen filtering to `server/services/recipe-search.ts` (exclude recipes containing the user's allergens)
- [ ] Confirm recipes carry allergen data the filter can match against
- [ ] Re-add the "Safe for me" toggle state + UI to `client/screens/meal-plan/RecipeBrowserScreen.tsx`
- [ ] Wire the toggle through to the search request
- [ ] Tests for the new search predicate

## Implementation Notes

- TODO marker: `client/screens/meal-plan/RecipeBrowserScreen.tsx:275`.
- The user's allergen list is available via the dietary profile (`userProfiles.allergies`).
- Decide whether filtering excludes or merely down-ranks recipes with matched allergens.

## Dependencies

- Recipe allergen data must exist on local recipes for matching to work.

## Risks

- If local recipes lack structured allergen data, this expands into a data-population task.

## Updates

### 2026-05-16

- Initial creation (audit 2026-05-16-unfinished-features, finding M3)
