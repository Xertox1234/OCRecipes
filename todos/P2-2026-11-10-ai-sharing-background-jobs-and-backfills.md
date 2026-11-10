---
title: "AI sharing: background promotion job and backfill scripts ignore the user's AI-off choice"
status: backlog
priority: medium
created: 2026-11-10
updated: 2026-11-10
assignee:
labels: [deferred, privacy, ai]
github_issue:
---

# AI sharing: background promotion job and backfill scripts ignore the user's AI-off choice

## Summary

The AI-sharing permission (privacy audit H3) is enforced for signed-in requests. Work that runs outside a request is not gated, and three such paths send user-authored recipe text to AI companies whatever the author chose.

## Background

Found while mapping every route that reaches `aiChat` for the H3 fix (2026-11-10). Out of that PR's scope; filed per `todos/README.md` → Deferred findings.

- `startPromotionJob` (every 6 h, `server/index.ts` → `server/services/canonical-promotion.ts` → `enrichRecipe` in `server/services/canonical-enrichment.ts`) sends a community recipe's title, ingredients and instructions to `aiChat` and Runware. `getEligibleForPromotion` (`server/storage/canonical-recipes.ts` ~74-110) has no `isPublic` filter and no check of the author's AI-sharing permission, so a private recipe from an author with AI off qualifies once its popularity counters cross the threshold.
- `server/scripts/backfill-recipe-spice-level.ts` and `server/scripts/backfill-recipe-images.ts` send every user's `mealPlanRecipes` titles and ingredients to `aiChat` (and Runware for images).
- The coach weekly report (branch `feat/coach-weekly-report`, not merged) will run per-user AI work outside a request and needs an explicit `isAiSharingAllowedFor(userId)` check.

## Acceptance Criteria

- [ ] The promotion job skips recipes that are private or whose author has AI sharing off (`users.ai_sharing_allowed_at IS NULL`)
- [ ] The two backfill scripts skip recipes owned by a user with AI sharing off
- [ ] Any new per-user AI job outside a request checks `isAiSharingAllowedFor` before the call
- [ ] Tests cover an author with AI off for each path
