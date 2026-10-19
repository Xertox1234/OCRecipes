---
title: "Check getSpoonacularSubstitutes against Spoonacular's terms (shows Spoonacular data at runtime)"
status: done
priority: medium
created: 2026-10-13
updated: 2026-10-19
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

- [x] Decide whether showing Spoonacular substitute text is allowed under the terms, including the attribution requirement. The owner decides; this is a licensing call.
- [x] If it isn't allowed, have the AI produce substitutions, or show attribution as the terms require.
- [x] Confirm the call path never caches beyond 1 hour.

## Implementation Notes

- `server/services/recipe-catalog.ts` — `getSpoonacularSubstitutes`
- `server/services/ingredient-substitution.ts` (~:25 import, ~:487 call)

## Updates

### 2026-10-19 — owner ruling: remove the Spoonacular tier

Measured before asking (grep/sed of `recipe-catalog.ts`, `ingredient-substitution.ts`, `dev-api-cache.ts`, the cooking and allergen-check routes, `coach-tools.ts`):

- No production cache on the path. The only cache in front of Spoonacular is the dev record/replay cache, off unless `NODE_ENV=development` with `API_CACHE` set, and it throws at boot if enabled in production. Nothing stored: both routes return the suggestions and persist nothing; the coach tool feeds the result to the model only.
- Terms re-read (spoonacular.com/food-api/terms): caching needs prior WRITTEN permission at all (max 1 h), which is stricter than the AC as written; attribution to Spoonacular is only required for invited hackathon/academic plans; "credit the original source" is about recipes; inaccuracy disclaimers are the integrator's responsibility. No disclaimer existed in either substitution view.
- Residual with "keep": the coach can echo a Spoonacular line into saved chat history.

Owner chose **remove the tier** over keep-with-disclaimer. Change: `getSubstitutions` is now Static → AI (one AI call per batch, as before); `getSpoonacularSubstitutes` and its schema deleted from `recipe-catalog.ts`; `coach-tools.ts` imports the substitution service statically (the cycle the lazy import guarded against is gone). Test: unmatched ingredients reach the AI tier in one call and no suggestion reason names Spoonacular.
