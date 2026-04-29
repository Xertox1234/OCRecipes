# Audit Changelog

Append-only history of all code audits performed on this project. Each entry links to the full audit manifest with detailed findings and resolutions.

## Format

```
### YYYY-MM-DD — Audit Title
- **Trigger:** Why the audit was run
- **Manifest:** [link to manifest file]
- **Findings:** X critical, Y high, Z medium, W low
- **Resolved:** N fixed, M deferred, P false-positive
- **Commit(s):** git SHA(s) of fix commits
```

---

## 2026-04-28 — Full Codebase Audit

- **Trigger:** Periodic full audit — 27 commits since 2026-04-26: OCR race+swap extended to front-label/receipt/menu scan flows, Coach Pro history truncation, storage decomposition, security/schema fixes
- **Manifest:** [docs/audits/2026-04-28-full.md](2026-04-28-full.md)
- **Findings:** 0 critical, 8 high, 17 medium, 21 low (47 total, from 6 agents)
- **Resolved:** 6 verified (C1, H1, H2, H3, H4, H5), 41 deferred (7 themed todos), 0 false-positive
- **Commit(s):** _(pending)_
- **Note:** Key fixes: `isFocused` re-wired to `useScanClassification` (L20 guard had been added but never connected — C1); `parseInt(UUID)` = NaN crash on every front-label confirm resolved by switching schema to `z.string()` (H2); `mealSuggestionCache` `onConflictDoNothing` + forced `!` crash on expired entries fixed with `onConflictDoUpdate` (H3); cooking session recipe endpoint now enforces daily quota + uses correct 3/min rate limiter (H1); `ReceiptReviewScreen` now preserves local OCR items when AI scan fails (H4+H5). Deferred 41 items to 7 todos: perf/DB column projection, RN memoization, security hardening (storage-layer defense-in-depth), data integrity schema gaps, architecture refactors, code quality/test coverage, camera/a11y.

## 2026-04-26 — Full Codebase Audit

- **Trigger:** Periodic full audit — uncommitted modifications to `HomeRecipeCard.tsx`, `RecipeGenerationModal.tsx`, `TextInput.tsx`, `theme.ts`, new `scripts/generate-app-assets.ts`, and agent/eval files since 2026-04-18
- **Manifest:** [docs/audits/2026-04-26-full.md](2026-04-26-full.md)
- **Findings:** 0 critical, 3 high, 15 medium, 29 low (47 total, from 6 agents)
- **Resolved:** 6 verified, 41 deferred (6 themed todos), 0 false-positive
- **Commits:** _(pending)_
- **Note:** Key fixes: remix badge now announced by screen readers (H1 parent label + accessible=false on badge); recipe image generation decoupled — `generateFullRecipe` returns immediately, `generateAndPatchRecipeImage` fires void after DB save saving 5-30s user-visible latency (H3); `shareToPublic` flag added to `recipeGenerationSchema` replacing two-step generate+share client calls (M1); `generate-app-assets.ts` refactored to dynamic-import `server/lib/runware.ts` removing 60-line HTTP client duplicate (M10); `dietChip` `minHeight: 44` added matching `optionChip` (M15); Prettier formatting errors cleared — 15 lint errors → 0 (L22). +1 test updated (recipe-generation: imageUrl now null from generateFullRecipe). Deferred 41 items to 6 todos: schema/data-integrity debt, accessibility remaining, performance/memoization, security hardening, architecture refactors, code quality.

## 2026-04-18 — Full Codebase Audit

- **Trigger:** Periodic full audit — ~30 commits / ~3.6K net LOC since audit #11 (recipes.ts 4-way split, MealPlanDay type-dep inversion, Coach Pro hardening, MiniSearch filter-chain consolidation + community mealType classification, seed-recipes prod guard + parallel pipeline, SkeletonBox shared shimmer timer, eval framework hardening, recipe-wizard a11y polish, cleanup script hardening, catalog save + URL import premium gating)
- **Manifest:** [docs/audits/2026-04-18-full.md](2026-04-18-full.md)
- **Findings:** 0 critical, 12 high, 40 medium, 31 low (83 total, 91 raw from 8 agents)
- **Resolved:** 12 high verified, 71 medium/low deferred (9 themed todos), 0 false-positive
- **Commits:** _(pending)_
- **Note:** Key fixes: recipe-generate preview now logs generation (H1 atomic `logRecipeGenerationWithLimitCheck` tx) + passes user profile (H2 allergen safety); `getUnifiedRecipes` symmetric mealType filter for community (H3); coach cache key now includes `isCoachPro` + UTC day bucket (H4/H5); Coach Pro tool-call budget exit yields closing message (H6); `GET /catalog/search` + `/:id` premium-gated (H7); `batchUpdateMealTypes` + `batchUpdateCommunityMealTypes` single-round-trip UPDATE + MiniSearch index refresh (H8); `coach-warm-up` consumes via public `.get()` (H9 partial); source-aware `numericPassThrough` lets community recipes with null nutrition surface in macro-filtered search (H10); `createChatMessageWithLimitCheck` enforces conversation ownership inside the tx (H11); `useAddCookPhoto` takes `sessionId` as mutation variable, not hook arg, fixing auto-analyze stale-closure bug (H12). +13 tests net (3 H1/H2, 1 H3, 2 H4/H5, 2 H7, 1 H8, 1 H10, 1 H11, plus 2 signature updates). Remaining 71 findings routed to 8 themed todos.

## 2026-04-17 — Full Codebase Audit

- **Trigger:** Periodic full audit — 8 commits / ~20K LOC since audit #10 (recipe creation wizard, recipe search overhaul with MiniSearch, nutrition coach evaluation framework, seed-recipes script overhaul, profile hub modal close buttons, collapsing headers, custom screen transitions, success feedback animations)
- **Manifest:** [docs/audits/2026-04-17-full.md](2026-04-17-full.md)
- **Findings:** 0 critical, 15 high, 28 medium, 26 low (69 total, 123 raw from 6 agents)
- **Resolved:** 15 high verified (14 fixed, 1 deferred), 1 medium false-positive, 2 low drive-by cleanups; 52 medium/low open for follow-up triage
- **Commits:** `6beabeb` (minisearch cluster), `d0975d9` (eval framework), `653ca2b` (wizard UX), `7cbc8ed` (perf), `9fd556f` (security/data-loss)
- **Note:** Key fixes: cleanup-seed-recipes scoped to orphan/demo-user authorId (prod data-loss risk), recipe-generate premium gate + quota, storage→service import direction restored via new `server/lib/search-index.ts`, MiniSearch concurrent-init guard with atomic retry reset, column-projected JSONB-free index loaders, index mutations moved outside db.transaction, parallel coach tool execution (b41245f regression), null-valued search filter correctness, KAV at wizard shell root, eliminated double discard-alert, AnimatedCheckmark timer cleanup, scroll-handler `runOnJS` gated to boolean transitions, zod-validated + version-anchored eval judge. +3 tests net. H9 (wizard test coverage) deferred to `todos/recipe-wizard-test-coverage.md`.

## 2026-04-12 — Full Codebase Audit

- **Trigger:** Periodic full audit — ~45 commits, ~16K LOC since audit #9 (Coach Pro, serving adjuster, UI interactions, favourites deferred items, accessibility)
- **Manifest:** [docs/audits/2026-04-12-full.md](2026-04-12-full.md)
- **Findings:** 1 critical, 4 high, 11 medium, 13 low (29 total, 41 raw from 6 agents)
- **Resolved:** 5 verified, 24 deferred (6 todos), 0 false-positive
- **Commit:** `6a999d1`
- **Note:** Key fixes: userId added to coach response cache hash (cross-user data leak), rate limiters on coach-context endpoints, client SSE error event handling (isStreaming stuck), add_to_meal_plan tool schema/handler alignment, followUpDate ISO date validation. 24 items deferred to 6 todos: service extraction, test coverage, notebook lifecycle, streaming perf, hardening, type cleanup. Coach Pro was source of 27/29 findings.

## 2026-04-09 — Full Codebase Audit

- **Trigger:** Periodic full audit — ~30 commits, ~13K LOC since audit #8 (favourites, recipe remix, cooking session consolidation, storage facade re-exports, todo skill)
- **Manifest:** [docs/audits/2026-04-09-full.md](2026-04-09-full.md)
- **Findings:** 0 critical, 2 high, 11 medium, 16 low (29 total, 40 raw from 6 agents)
- **Resolved:** 18 verified, 11 deferred (5 todos), 0 false-positive
- **Commit:** `6a802fd`
- **Note:** Key fixes: IDOR ownership checks on favouriteRecipes toggle/resolve/share, isPublic filter on community recipe share, rate limiters on 4 endpoints, column-restricted select (no JSONB over-fetch), Promise.all for tx queries + SSE waterfall, favouriteRecipes orphan cleanup in delete functions, pg_advisory_xact_lock for TOCTOU, cacheAffectingFields sync, Drizzle relations, duplicate type removal. +11 tests net. Deferred: cascading re-render refactor, share endpoint relocation, test coverage suite, nav type, test internals cleanup.

## 2026-04-07 — Full Codebase Audit (Round 2)

- **Trigger:** Post-OCR-feature audit — 12 commits (~2200 LOC) landed since audit #6
- **Manifest:** [docs/audits/2026-04-07-full-2.md](2026-04-07-full-2.md)
- **Findings:** 0 critical, 2 high, 13 medium, 13 low (28 total, 43 raw from 6 agents)
- **Resolved:** 27 verified, 0 deferred, 4 false-positive (incl. L6 reclassified)
- **Commit:** `0367744`, `81d7fbb`
- **Note:** Key fixes: calories regex negative lookahead for "from Fat", mutation dep destructuring for stable useCallback, `cancelAnimation` on reducedMotion toggle, barcode Zod validation on 3 endpoints, OCR parser negative/upper-bound guards, `barcodeNutrition` CHECK constraints, `useScanClassification` timeout cleanup bug, label-analysis-utils extraction with 13 tests, useOCRDetection 10 tests, parser 6 edge-case tests. +28 tests net.

## 2026-04-07 — Full Codebase Audit

- **Trigger:** Periodic full codebase audit
- **Manifest:** [docs/audits/2026-04-07-full.md](2026-04-07-full.md)
- **Findings:** 0 critical, 5 high, 14 medium, 11 low (30 total)
- **Resolved:** 23 verified, 6 deferred (H1/H2/M5/M14/L10 architectural refactors + H1 service extraction), 1 false-positive (L4 defense-in-depth filter)
- **Commit:** `da63a26`
- **Note:** Key fixes: `verifyGroceryListOwnership` for IDOR checks, cookbook orphan-aware `recipeCount`, `handleRouteError` migration (23 catch blocks in 4 files), Zod body validation on grocery update, CORS PATCH method, update function whitelists (M7/M8), pantry item limit (M9), TOCTOU race catch (M10), barcode format validation, photo endpoint rate limiters, `notNull` on source columns. Lint warnings reduced from 9 to 0.

## 2026-04-02 — Full Codebase Audit

- **Trigger:** Periodic full codebase audit
- **Manifest:** [docs/audits/2026-04-02-full.md](2026-04-02-full.md)
- **Findings:** 1 critical, 6 high, 17 medium, 11 low (35 total)
- **Resolved:** 33 verified, 2 deferred (M13: split \_helpers.ts, M16: consolidate buildDietaryContext)
- **Commit:** `cbbd92f`
- **Note:** Key fixes: `is_public` index on community_recipes, `updateUser` field whitelist, API key prefix unique constraint, storage/service layering violations resolved, 12 routes standardized to `handleRouteError`, AI prompt input sanitization gap closed. 6 archived todos from previous audits resolved. Net -53 LOC.

## 2026-04-01 — Authentication System Security Audit

- **Trigger:** Targeted security audit of the authentication system
- **Manifest:** [docs/audits/2026-04-01-security-auth.md](2026-04-01-security-auth.md)
- **Findings:** 0 critical, 0 high, 3 medium, 1 low (4 total)
- **Resolved:** 4 verified, 0 deferred, 0 false-positive
- **Commit:** (pending)
- **Note:** Key fixes: atomic tokenVersion increment (TOCTOU), password hash excluded from default getUser queries, API key cache uses SHA-256 hash keys, JWT iss/aud claims added.

## 2026-03-31 — Performance & Data-Integrity Audit

- **Trigger:** Found generated images stored in DB; targeted audit for similar performance/data-integrity issues
- **Manifest:** [docs/audits/2026-03-31-performance.md](2026-03-31-performance.md)
- **Findings:** 0 critical, 2 high, 4 medium, 3 low (9 actionable, 7 dropped as below-threshold)
- **Resolved:** 9 verified, 0 deferred
- **Commit:** (pending)
- **Note:** Key fix: `transactions.receipt` was storing full IAP receipts (50-200KB+) — same class as images-in-DB. Also fixed unbounded cache growth, N+1 inserts, missing unique constraints, and orphaned data.

## 2026-03-30 — Full Audit (Round 3)

- **Trigger:** Periodic full codebase audit
- **Manifest:** [docs/audits/2026-03-30-full.md](2026-03-30-full.md)
- **Findings:** 0 critical, 1 high, 8 medium (9 actionable out of 33 raw agent findings — 24 dropped as below-threshold)
- **Resolved:** 9 verified, 0 deferred
- **Commit:** `893fcd5`
- **Note:** Fourth consecutive audit. Agents trending toward diminishing-return findings. Recommending shift to targeted audits.

## 2026-03-29 — Full Audit (Round 2)

- **Trigger:** Periodic full codebase audit (first with all 5 domains reporting)
- **Manifest:** [docs/audits/2026-03-29-full-2.md](2026-03-29-full-2.md)
- **Findings:** 0 critical, 3 high, 7 medium, 12 low (22 total)
- **Resolved:** 17 verified, 5 deferred (L1/L3/L4/L6/L7 — structural refactors)
- **Commit:** `2c18392`

## 2026-03-29 — Full Audit

- **Trigger:** Periodic full codebase audit
- **Manifest:** [docs/audits/2026-03-29-full.md](2026-03-29-full.md)
- **Findings:** 0 critical, 4 high, 10 medium, 8 low (22 total)
- **Resolved:** 20 verified, 1 deferred (M7 — JSONB validation), 1 false-positive (L4 — sequential loop)
- **Commit:** `4a50a06` fix: resolve full audit findings (20 verified, 1 deferred)
- **Note:** Architecture and code-quality agents hit rate limits (3/5 domains reported)

## 2026-03-27 — Full Audit

- **Trigger:** Full codebase audit across all domains
- **Manifest:** [docs/audits/2026-03-27-full.md](2026-03-27-full.md)
- **Findings:** 0 critical, 6 high, 14 medium, 10 low (30 total)
- **Resolved:** 0 fixed, 30 deferred (all tracked in `todos/001-030`)
- **Note:** Code quality agent hit rate limit; findings from 4/5 domains (security, performance, data-integrity, architecture)

## 2026-03-27 — Launch Readiness Audit (Round 2)

- **Trigger:** Second-pass audit after first round left unfixed items
- **Manifest:** No structured manifest (pre-workflow). Findings tracked in conversation only.
- **Findings:** 3 critical, 9 high, 7 medium, 1 low (net-new after dedup)
- **Resolved:** 11 fixed, 0 deferred, 0 false-positive
- **Commit:** `0a6c43c` fix: resolve verified audit findings with per-fix test verification

## 2026-03-27 — Launch Readiness Audit (Round 1)

- **Trigger:** Pre-launch readiness check
- **Manifest:** No structured manifest (pre-workflow). Findings were in agent output.
- **Findings:** ~30+ across 5 domains (security, performance, data, architecture, quality)
- **Resolved:** ~15 fixed, 3 deferred to todos, ~12 silently dropped (root cause of round 2)
- **Commits:** `cb1fc6a`..`16f8d6f` (6 commits)
- **Lesson:** Bulk fix without per-item verification led to incomplete resolution. This triggered creation of the structured audit workflow.
