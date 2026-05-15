---
title: "Architecture refactors from 2026-04-26 audit"
status: done
priority: medium
created: 2026-04-26
updated: 2026-04-28
labels: [architecture, refactor, audit-2026-04-26]
audit_ids: [M11, L26, L27, L28]
---

# Architecture refactors from 2026-04-26 audit

## Summary

Four architecture issues. M10 (`generate-app-assets.ts` duplicating `server/lib/runware.ts`) was fixed in the 2026-04-26 fix pass. These four remain: one large module decomposition and three cross-domain/domain-mixing issues.

## Findings (cross-ref `docs/audits/2026-04-26-full.md`)

- **M11** — `server/storage/meal-plans.ts` is 1,254 lines — 2.5× the documented 500-line split threshold. Contains five clearly demarcated domains: meal plan recipes (lines 54–460), meal plan items (lines 461–612), grocery lists (lines 613–790), pantry items (lines 791–1135), analytics helpers (lines 1136–1254). The pattern docs list `grocery-lists.ts` and `pantry.ts` as the expected decomposition target.
- **L26** — `RecipeGenerationModal` sends an `ingredients: foods` field in the `POST /api/recipes/generate` body that Zod silently strips on the server. `RecipeGenerationInput` has no `ingredients` parameter; the structured data never reaches `generateFullRecipe`. Either wire up the field server-side or remove it from the client request. `client/components/RecipeGenerationModal.tsx:77–79`
- **L27** — `saveRecipeFromChat` in `server/storage/chat.ts` (lines 381–477) writes to `communityRecipes` — a cross-domain operation from a chat-domain storage module. It is the only cross-domain function in the file. Per the architecture pattern, cross-domain writes belong in a dedicated module (e.g., `server/storage/recipe-from-chat.ts`). `server/storage/chat.ts:381–477`
- **L28** — `server/storage/users.ts` contains weight logs (lines 402–509) and HealthKit sync (lines 510–561) — two domains with no coupling to user account management. At 561 lines, the file is slightly over the threshold. Weight and HealthKit functions would fit naturally in a `server/storage/health.ts` module.

## Acceptance Criteria

- [x] `server/storage/meal-plans.ts` split into at minimum `server/storage/grocery-lists.ts` and `server/storage/pantry.ts`; remaining meal-plan-specific functions stay in a reduced `meal-plans.ts` or split further; `server/storage/index.ts` re-exports updated
- [x] `ingredients` field in `RecipeGenerationModal` wired up client-side: `foods` array converted to `ingredientsContext` string via `formatIngredientsContext()` and passed as `productName`
- [x] `saveRecipeFromChat` extracted to `server/storage/recipe-from-chat.ts`; `chat.ts` and callers updated
- [x] Weight log + HealthKit functions in `users.ts` extracted to `server/storage/health.ts`; `server/storage/index.ts` re-exports updated; callers updated
- [x] All existing tests pass after each extraction; route-level tests still hit the same endpoints

## Implementation Notes

- M11 is the most impactful change — affects many callers. Do it in a focused refactor PR; it's pure function-moving with no logic changes.
- L26 (ingredients field): the structured `foods` array could genuinely improve recipe generation quality (vs the current concatenated `productName` string). Worth discussing whether to wire it up properly rather than just deleting it.
- L27 and L28 are extraction-only refactors with no logic changes.
