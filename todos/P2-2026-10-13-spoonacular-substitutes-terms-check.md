---
title: "Check getSpoonacularSubstitutes against Spoonacular's terms (shows Spoonacular data at runtime)"
status: backlog
priority: medium
created: 2026-10-13
updated: 2026-10-13
assignee:
labels: [deferred, api]
github_issue:
---

# Check getSpoonacularSubstitutes against Spoonacular's terms

## Summary

The inspired-recipes spec (§5, "Out of scope") left one Spoonacular use for a separate check. `getSpoonacularSubstitutes` (`server/services/recipe-catalog.ts`, used by ingredient substitution) shows Spoonacular substitute data to users at runtime without storing it.

## Background

Spoonacular's terms (spoonacular.com/food-api/terms, read 2026-10-12) say:

- Cache for at most 1 hour.
- Store only the recipe id, title and image URL.
- No reselling.
- Credit the source.

The recipe catalog was moved to "inspiration only" (#1429) because of these terms. Substitutions were not reviewed.

## Acceptance Criteria

- [ ] Decide whether showing Spoonacular substitute text is allowed under the terms, including the attribution requirement. The owner decides; this is a licensing call.
- [ ] If it isn't allowed, have the AI produce substitutions, or show attribution as the terms require.
- [ ] Confirm the call path never caches beyond 1 hour.

## Implementation Notes

- `server/services/recipe-catalog.ts` — `getSpoonacularSubstitutes`
- `server/services/ingredient-substitution.ts` (~:25 import, ~:487 call)
