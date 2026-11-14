---
title: "Recipe popularity counters trust a recipe id the client sends"
status: backlog
priority: low
created: 2026-11-10
updated: 2026-11-10
assignee:
labels: [deferred, data-integrity]
github_issue:
---

# Recipe popularity counters trust a recipe id the client sends

## Summary

A cook session or a meal-plan save can name any `sourceCommunityRecipeId`, and the server adds to that recipe's popularity counters without checking that the recipe is public or that the user can see it. One logged cook session crosses the promotion threshold (`cookSessions: 1`).

## Background

Found while fixing privacy audit M13 (2026-11-10). That fix stops a private recipe, or one whose author has AI sharing off, from being promoted or sent to AI, so this is no longer a privacy gap. What remains is that one user can push any public recipe into the featured set, and counters on private recipes still grow.

- `server/routes/cooking.ts` ~138 takes `sourceCommunityRecipeId` from the request body; ~502 increments on log.
- `server/routes/meal-plan.ts` ~158 does the same on save.
- `incrementRecipePopularity` (`server/storage/canonical-recipes.ts`) updates by id alone.

## Acceptance Criteria

- [ ] The increment applies only to a recipe that is public (one `WHERE` in `incrementRecipePopularity`)
- [ ] Owner decision recorded: whether an author's own cook sessions and saves should count
- [ ] Test: a private recipe's counters do not move
