---
title: "Architecture: storage-layer purity + service extraction (2026-04-28 audit)"
status: in-progress
priority: low
created: 2026-04-28
updated: 2026-04-28
assignee:
labels: [architecture, refactor]
---

# Architecture: Storage-Layer Purity + Service Extraction

## Summary

Two storage functions call `inferMealTypes` inline (violating storage-layer purity). Subscription tier caching logic lives in a route file. Minor facade and extraction gaps.

## Background

From the 2026-04-28 audit (M4, M5, M6, L10, L11, L12, L13). Low urgency — these are structural correctness issues, not bugs.

## Acceptance Criteria

- [ ] **M4** `community.ts:withInferredMealTypes` — move `inferMealTypes` call to the route/service layer; storage receives pre-computed `mealTypes` param
- [ ] **M5** `recipe-from-chat.ts:saveRecipeFromChat` — same: compute meal types in the chat route before calling storage
- [ ] **M6** `recipes.ts:44-69` — extract `generationStatusTierCache` and `resolveGenerationStatusFeatures` to `server/services/subscription-tier-cache.ts`
- [ ] **L11** `FrontLabelConfirmScreen` — extract `shouldReplace` logic to `client/screens/front-label-confirm-utils.ts` (matching sibling screens)
- [ ] **L12** `recipe-generation.ts:394` — replace dynamic `import("../storage/index")` with static top-level import; investigate and resolve the root circular dependency
- [ ] **L13** `storage/index.ts` — re-export `warmUpStore` via the storage facade

## Implementation Notes

For M4/M5: the `inferMealTypes` call in `withInferredMealTypes` is called by `createCommunityRecipe`, `createRecipeWithLimitCheck`, and `saveRecipeFromChat`. The refactor requires updating all callers to pass computed `mealTypes`.

## Updates

### 2026-04-28

- Created from audit findings M4, M5, M6, L10, L11, L12, L13
