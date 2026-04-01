# Audit: Performance Audit

> **Date:** 2026-03-31
> **Trigger:** Found generated images stored in DB; checking for similar performance/data-integrity issues
> **Domains:** performance, data-integrity
> **Baseline:** 3207 tests passing (226 files) | 4 type errors | 13 lint errors, 13 warnings

## Findings

### Critical

| ID  | Finding              | File(s) | Status | Verification |
| --- | -------------------- | ------- | ------ | ------------ |
| —   | No critical findings | —       | —      | —            |

### High

| ID  | Finding                                                                                                         | File(s)                         | Status   | Verification                                                                           |
| --- | --------------------------------------------------------------------------------------------------------------- | ------------------------------- | -------- | -------------------------------------------------------------------------------------- |
| H1  | `transactions.receipt` stores full IAP receipts (50-200KB+) as unbounded `text`                                 | `server/routes/subscription.ts` | verified | grep confirms `compactReceipt()` on all 3 storage calls; 42/42 subscription tests pass |
| H2  | `carouselSuggestionCache` excluded from periodic `purgeExpiredCacheRows` — expired rows accumulate indefinitely | `server/storage/cache.ts`       | verified | grep confirms `carouselSuggestionCache` in purge tables array; 28/28 cache tests pass  |

### Medium

| ID  | Finding                                                                                                | File(s)                                                       | Status   | Verification                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------ |
| M1  | `getDismissedRecipeIds` fetches ALL dismissals per user without limit/TTL — unbounded growth           | `server/storage/carousel.ts`                                  | verified | grep confirms 90-day filter + `.limit(500)`; 19/19 carousel tests pass                           |
| M2  | `createMealPlanFromSuggestions` runs 2-3N sequential inserts in loop (21-meal plan = ~63 round trips)  | `server/storage/meal-plans.ts`                                | verified | Refactored to 3 batch inserts; 140/140 meal plan tests pass                                      |
| M3  | `weightLogs` uses `index()` not `uniqueIndex()` on (userId, loggedAt) — allows duplicate entries       | `shared/schema.ts`, `server/storage/users.ts`                 | verified | `uniqueIndex` in schema + `onConflictDoUpdate` in both insert functions; 31/31 weight tests pass |
| M4  | `cookbookRecipes.recipeId` has no FK constraint — orphan rows from deleted recipes (lazy cleanup only) | `server/storage/meal-plans.ts`, `server/storage/community.ts` | verified | Both delete functions now cascade-delete `cookbookRecipes` junction rows; 192/192 tests pass     |

### Low

| ID  | Finding                                                                                               | File(s)                                                             | Status   | Verification                                                                                                         |
| --- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------- |
| L1  | `chatMessages.metadata` typed as `unknown` — open door for arbitrary large JSONB payloads             | `server/storage/chat.ts`                                            | verified | Type narrowed to `Record<string, string \| number \| boolean \| null> \| null`; 41/41 chat tests pass                |
| L2  | `communityRecipes.authorId` uses `onDelete: "set null"` — orphans recipes with no owner/admin cleanup | `server/storage/users.ts`                                           | verified | `deleteUser` now explicitly deletes community recipes + cookbook junction rows in transaction; 88/88 auth tests pass |
| L3  | Double-fetch of dismissed recipe IDs in carousel build                                                | `server/storage/carousel.ts`, `server/services/carousel-builder.ts` | verified | `dismissedIds` passed through via `RecentRecipeFilters`; 19/19 carousel tests pass                                   |

### Dropped (false-positive or below threshold)

| Finding                                           | Reason                                                                                     |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `getDailyLogs` no limit                           | Date-scoped query naturally bounds results; impractical to hit hundreds of logs in one day |
| `getGroceryListWithItems` no limit                | List-scoped; items are human-managed and naturally small                                   |
| `getScannedItemsByIds` unbounded array            | All callers pass small arrays from controlled sources                                      |
| `nutritionCache.data` stores full objects         | Only known fields via typed `NutritionData` interface; destructured before insert          |
| `chatMessages.content` unbounded                  | Controlled by `max_completion_tokens: 1000`; natural bound                                 |
| `savedItems.instructions` unbounded               | Cached from bounded AI responses; low risk                                                 |
| Nutrition cache TTL no reformulation invalidation | 7-day TTL provides reasonable bound; reformulation is rare                                 |

## Deferred Items

| ID  | Todo | Rationale |
| --- | ---- | --------- |
| —   | —    | —         |

## Summary

| Severity  | Found | Verified | Deferred | False-positive | Open  |
| --------- | ----- | -------- | -------- | -------------- | ----- |
| Critical  | 0     | 0        | 0        | 0              | 0     |
| High      | 2     | 2        | 0        | 0              | 0     |
| Medium    | 4     | 4        | 0        | 0              | 0     |
| Low       | 3     | 3        | 0        | 0              | 0     |
| **Total** | **9** | **9**    | **0**    | **0**          | **0** |

## Fix Commits

| Commit | Description |
| ------ | ----------- |
| —      | —           |
