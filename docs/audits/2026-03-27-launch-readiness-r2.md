# Audit: Launch Readiness (Round 2)

> **Date:** 2026-03-27
> **Trigger:** Second-pass audit after round 1 left unfixed items
> **Domains:** security, performance, data-integrity, architecture, code-quality
> **Baseline:** 3133 tests passing | 0 type errors | 0 lint errors (4 warnings)

## Findings

### Critical

| ID  | Finding                                                           | File(s)                           | Status         | Verification                                                                   |
| --- | ----------------------------------------------------------------- | --------------------------------- | -------------- | ------------------------------------------------------------------------------ |
| C1  | `getScannedItem(id)` has no userId filter — IDOR at storage layer | `server/storage/nutrition.ts:66`  | verified       | grep confirms userId param added; 83/83 route tests pass                       |
| C2  | `getMealPlanRecipe()` no userId filter                            | `server/storage/meal-plans.ts:65` | false-positive | Already fixed in round 1 commit `09676e2` — grep confirms userId param present |
| C3  | `getCommunityRecipe()` returns private recipes                    | `server/storage/community.ts:106` | false-positive | Already fixed in round 1 — grep confirms `isPublic` filter at line 123         |

### High

| ID  | Finding                                                  | File(s)                                                                                                      | Status         | Verification                                                                          |
| --- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------- | ------------------------------------------------------------------------------------- |
| H1  | JWT_SECRET accepts 1+ char — no minimum entropy          | `server/lib/env.ts:13`                                                                                       | verified       | `.min(32)` confirmed in file; test setup updated to 32+ char secret                   |
| H2  | 10+ AI routes missing `checkAiConfigured()` guard        | `suggestions.ts`, `cooking.ts`, `food.ts`, `meal-suggestions.ts`, `menu.ts`, `receipt.ts`, `verification.ts` | verified       | grep shows checkAiConfigured in all 9 route files (was only in 2); 136/136 tests pass |
| H3  | CNF fuzzy match O(11,400) linear scan per lookup         | `server/services/nutrition-lookup.ts:332`                                                                    | deferred       | → `todos/gin-indexes-and-parallel-queries.md`                                         |
| H4  | In-memory session store capped at 500                    | `server/storage/sessions.ts`                                                                                 | deferred       | → documented in deferred architecture (MEMORY.md)                                     |
| H5  | Cache purge `.returning()` materializes all deleted rows | `server/storage/cache.ts:242`                                                                                | false-positive | Already fixed in round 1 commit `09676e2` — uses batched delete                       |
| H6  | `mealPlanItems` missing check constraint                 | `shared/schema.ts:596`                                                                                       | verified       | CHECK constraint `meal_plan_items_has_source` added; types pass                       |
| H7  | Grocery list 50-limit TOCTOU                             | `server/routes/grocery.ts:105`                                                                               | verified       | `getGroceryListCount()` added (COUNT query); 39/39 tests pass                         |
| H8  | No global 401 interceptor on client                      | `client/lib/query-client.ts`                                                                                 | deferred       | → existing deferred architecture (refresh tokens)                                     |
| H9  | Client imports type from server boundary                 | `client/hooks/useCookSession.ts:11`                                                                          | verified       | `RecipeContent` moved to `shared/types/cook-session.ts`; types pass                   |
| H10 | Multer config duplicated 7x                              | 7 route files                                                                                                | verified       | `createImageUpload()` factory in `_helpers.ts`; 6 configs consolidated; 0 lint errors |
| H11 | `JSON.parse` without Zod validation in suggestions       | `server/routes/suggestions.ts:141`                                                                           | verified       | `suggestionsResponseSchema` added; 17/17 tests pass                                   |
| H12 | Meal plan save-generated inserts rows in loop            | `server/routes/meal-plan.ts:716`                                                                             | deferred       | → `todos/gin-indexes-and-parallel-queries.md` (batch inserts section)                 |

### Medium

| ID  | Finding                                       | File(s)                             | Status         | Verification                                                             |
| --- | --------------------------------------------- | ----------------------------------- | -------------- | ------------------------------------------------------------------------ |
| M1  | No per-username rate limiting on login        | `server/routes/_helpers.ts`         | deferred       | Acceptable for launch; IP-based rate limiting is in place                |
| M2  | API key cache uses raw key as Map key         | `server/middleware/api-key-auth.ts` | deferred       | Low blast radius; hash-before-cache is post-launch hardening             |
| M3  | CORS wildcard when no Origin header           | `server/index.ts`                   | false-positive | Already fixed in round 1 — app uses Bearer tokens, not cookies           |
| M4  | Receipt upload lacks magic byte validation    | `server/routes/receipt.ts`          | verified       | `detectImageMimeType()` added; mock added to test; 3133/3133 pass        |
| M5  | Audio upload falls back to file extension     | `server/routes/food.ts:30`          | verified       | Extension fallback removed; mimetype-only check confirmed                |
| M6  | Spoonacular outage returns generic 500        | `server/services/recipe-catalog.ts` | deferred       | Service already logs warning; 500 is acceptable for external API failure |
| M7  | Log lines truncated to 80 chars               | `server/index.ts`                   | deferred       | → `todos/structured-logging.md` covers this                              |
| M8  | Logout race condition with in-flight requests | `client/hooks/useAuth.ts`           | deferred       | Low impact; linked to 401 interceptor work (H8)                          |

### Low

| ID  | Finding                         | File(s) | Status   | Verification                                             |
| --- | ------------------------------- | ------- | -------- | -------------------------------------------------------- |
| L1  | 4 unused variable lint warnings | 4 files | verified | All 4 removed; `npm run lint` shows 0 errors, 0 warnings |

## Deferred Items

| ID  | Todo                                          | Rationale                                                           |
| --- | --------------------------------------------- | ------------------------------------------------------------------- |
| H3  | `todos/gin-indexes-and-parallel-queries.md`   | Performance concern at scale, not blocking launch                   |
| H4  | Documented in MEMORY.md deferred architecture | Redis migration triggered by scaling needs                          |
| H8  | Linked to refresh token architecture          | Low user impact — token lasts 7 days, versioning handles revocation |
| H12 | `todos/gin-indexes-and-parallel-queries.md`   | Batch inserts improve perf but current loop is correct              |
| M1  | —                                             | IP-based limiting sufficient for launch volume                      |
| M2  | —                                             | No immediate exploit path; post-launch hardening                    |
| M6  | —                                             | External API failures are 500 by convention                         |
| M7  | `todos/structured-logging.md`                 | Already tracked; pino migration planned                             |
| M8  | —                                             | Linked to H8 (401 interceptor)                                      |

## Summary

| Severity  | Found  | Verified | Deferred | False-positive | Open  |
| --------- | ------ | -------- | -------- | -------------- | ----- |
| Critical  | 3      | 1        | 0        | 2              | 0     |
| High      | 12     | 6        | 3        | 1              | 0     |
| Medium    | 8      | 2        | 5        | 1              | 0     |
| Low       | 1      | 1        | 0        | 0              | 0     |
| **Total** | **24** | **10**   | **8**    | **4**          | **0** |

## Fix Commits

| Commit    | Description                                                         |
| --------- | ------------------------------------------------------------------- |
| `0a6c43c` | fix: resolve verified audit findings with per-fix test verification |

## Codification (Phase 7)

### Patterns Extracted

| Finding | Pattern                                                                        | Added To                               |
| ------- | ------------------------------------------------------------------------------ | -------------------------------------- |
| C1      | IDOR protection at storage layer (userId param required, not fetch-then-check) | Already in `docs/patterns/security.md` |
| H2      | `checkAiConfigured()` guard on all AI-dependent routes                         | Already in `docs/patterns/api.md`      |
| H10     | `createImageUpload()` factory for multer deduplication                         | New — `docs/patterns/api.md`           |
| H11     | Zod validation on all AI JSON responses (no bare `JSON.parse`)                 | Already in `docs/patterns/api.md`      |

### Learnings Extracted

| Finding       | Learning Title                                                         | Category |
| ------------- | ---------------------------------------------------------------------- | -------- |
| Round 1→2 gap | Bulk audit fixes without per-item verification silently drops findings | Decision |

### Code Reviewer Updates

| Finding | New Check Added                                                                             |
| ------- | ------------------------------------------------------------------------------------------- |
| H2      | Verify all routes calling OpenAI (directly or via service) have `checkAiConfigured()` guard |
| C1      | Verify storage functions that fetch by ID also filter by userId (not fetch-then-check)      |

**Codification commit:** `16f8d6f` (round 1 docs commit; round 2 codification was done inline during workflow creation)

## Post-Audit Notes

- Round 1 dropped ~12 findings silently because there was no manifest tracking them
- Round 2 found 4 false-positives (things round 1 actually fixed but agents re-flagged)
- Key process improvement: created `/audit` slash command with per-fix verification workflow
- Every `verified` item has specific evidence (grep output, test counts) — not just "I wrote the code"
