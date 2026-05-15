---
title: "Session 2026-04-17 Code Review Followups"
status: done
priority: medium
created: 2026-04-17
updated: 2026-04-18
assignee:
labels: [code-review-followup, audit-followup]
---

# Session 2026-04-17 Code Review Followups

## Summary

13 findings (3 High / 4 Medium / 6 Low) from the code-reviewer pass against
the 9 todos landed in session 2026-04-17. No critical issues; nothing blocks
merge. The two High items are abstraction-integrity concerns (session-store
`_internals` leak, premium-gate parity) rather than correctness bugs.

## Background

The `/todo` orchestrator session on 2026-04-17 landed these commits:

- `400b672` — cleanup-seed-recipes hardening
- `79cf444` — SkeletonProvider shared shimmer timer
- `c5aab1c` — Coach Pro followup hardening
- `575589f` — seed-recipes prod guard + p-limit
- `945df21` — MiniSearch correctness + mealTypes column
- `354d590` — eval framework hardening
- `df2a224` — recipe wizard step-component tests
- `de90151` — recipe wizard a11y polish
- `bed927e` — architecture followups (routes.ts split)

The code-reviewer subagent reviewed this range against the full rubric in
`.claude/agents/code-reviewer.md`. These are the surfaced gaps.

## Acceptance Criteria

### High

- [x] **H-1** Remove `_internals` leak in `setWarmUp` —
      `server/services/coach-warm-up.ts:80-97` writes directly to
      `_internals.store`, `_internals.timeouts`, `_internals.userCount`,
      bypassing `canCreate()` which enforces `WARM_UP_MAX_PER_USER = 1`
      and `WARM_UP_MAX_GLOBAL = 1000`. A client with varied conversation
      IDs can grow `userCount[userId]` past the per-user cap. Either: 1. Extend `createSessionStore` with `createWithKey(key, data)` that
      honors `canCreate()` before writing, OR 2. Replace the warm-up store with a purpose-built bounded map that
      doesn't pretend to be a session store.
- [x] **H-2** Premium-gate parity for paid-API endpoints —
      `server/routes/recipe-catalog.ts:POST /save` (Spoonacular detail
      call = quota unit) and `server/routes/recipe-import.ts:POST /import`
      (Runware/DALL-E image gen via fire-and-forget) hit paid external
      APIs with rate-limit-only protection. Either add
      `checkPremiumFeature(req, res, "urlImport", "URL import")` /
      `"catalogSave"` gates, OR codify in a docs/decisions note that these
      remain free-tier with rate-limits as the only defense.
- [x] **H-3** Consider separate within-case CI in `bootstrapMeanCI` —
      `evals/runner.ts:149-184` mixes cross-case variance and judge noise
      when `samplesPerCase > 1`. The CI is wider than a true judge-noise
      CI. Non-blocking — add a blocked-bootstrap variant OR clarify the
      comment at line 220-222 that the reported CI is NOT a within-case
      stability measure.

### Medium

- [x] **M-1** Avoid nested `<SkeletonProvider>` —
      `client/components/SkeletonLoader.tsx:261-266`'s `<SkeletonList>`
      wraps its own provider. Screens (e.g., `HistoryScreen`,
      `ItemDetailScreen`) that also wrap in `<SkeletonProvider>` end up
      with two shimmer worklets. Either document nesting as acceptable
      (keeps `SkeletonList` self-contained), or guard the inner provider
      with `useContext(SkeletonShimmerContext)` and skip wrapping when
      already inside a provider.
- [x] **M-2** `SharedSkeletonBox` still runs a worklet under reducedMotion
      — `client/components/SkeletonLoader.tsx:122-154` always invokes
      `useAnimatedStyle`. The doc comment at line 28 claims "without
      running any worklet" which is incorrect. Have the provider publish
      `{ shimmerValue, reducedMotion }` as the context value so
      `SharedSkeletonBox` can skip `useAnimatedStyle` entirely when
      motion is reduced (apply `opacity: 0.7` as a static style).
- [x] **M-3** Persist `judgeModel` per case —
      `evals/runner.ts:120-132` destructures only `{ scores,
  calorieAssertionPassed }` from `judgeResponse`, dropping
      `judgeModel`. Add `judgeModel: string` to `EvalCaseResult`
      (`evals/types.ts:106-117`) and populate in `evaluateCase`. Required
      by the "Version-Anchor LLM Models in Persisted Results" pattern —
      future multi-model comparisons need per-case granularity.
- [x] **M-4** `coach_notebook.dedupeKey` NULL rows bypass uniqueness —
      `shared/schema.ts:1439` keeps `dedupeKey` nullable for legacy rows.
      Postgres treats NULLs as distinct, so `onConflictDoNothing({ target:
  coachNotebook.dedupeKey })` in `server/storage/coach-notebook.ts:55-59`
      doesn't protect paths that forget to set the key. Either backfill
      legacy rows with synthetic fingerprints + `NOT NULL`, or add a
      log-warn in `createNotebookEntries` when entries arrive without a
      `dedupeKey`.

### Low

- [x] **L-1** `server/routes/recipes.ts:370` uses inline `const { authorId:
  _, ...safeRecipe } = recipe;` — other handlers (lines 60, 99) and
      `recipe-search.ts:109` use the shared `stripAuthorId()` helper.
      Either extend `_recipe-helpers.ts` with a `stripAuthorIdOne()`
      variant or call `stripAuthorId([recipe])[0]`.
- [x] **L-2** `server/routes/recipe-import.ts:93-96, 221-228` catch blocks
      use `logger.error + sendError` instead of `handleRouteError(res,
  err, "context")`. ZodErrors currently pre-parse via `.safeParse()`
      so no Zod instance reaches the catch, but normalize the pattern per
      audit M14.
- [x] **L-3** `recipe-import.ts:22-30` URL schema `max(2000)` allows
      longer URLs than most servers accept. Consider `max(1024)` unless
      there's a specific use case for long URLs.
- [x] **L-4** `server/scripts/cleanup-seed-recipes.ts:38`
      `TEST_PRODUCT_NAMES` is a hardcoded allowlist. New test fixtures
      leak past cleanup. Not blocking — the `authorId IS NULL | demoUserId`
      scope contains the blast radius, but consider a per-test-factory
      naming convention or a dedicated `isSeedTest: true` column.
- [x] **L-5** `client/components/SkeletonLoader.tsx:18-28` doc comment
      overstates savings — the shared-driver win is "one timer + one
      withRepeat writer" not "no per-box worklet". Clarify wording.
- [x] **L-6** `evals/runner.ts:487-502` sequential nested for-loops mean
      50 cases × 3 samples = 150 serial Anthropic calls at ~3-5s each =
      10+ min per run. `pLimit(5)` would cut to ~2 min. Not blocking —
      eval runs are infrequent and serial output is easier to debug, but
      worth adding when sample sizes grow.

## Implementation Notes

- **H-1 is the highest-impact fix** — the warm-up path sees every
  authenticated user that opens a coach-pro conversation. Prioritize
  before scaling the warm-up endpoint.
- **H-2 hinges on a product decision** (free-tier vs premium-tier
  policy for catalog/import). Bring to a product sync before coding.
- **M-1 and M-2 both touch `SkeletonLoader.tsx`** — schedule together to
  avoid double-disturbing the provider API.
- **M-3 is a 5-minute fix** — add one field to `EvalCaseResult` and
  wire it through `evaluateCase`. Can land independently.
- **L-2 is a 10-minute fix** — migrate 2 catch blocks to `handleRouteError`.
- **L-6 upgrade** can be gated behind an env var `EVAL_PARALLELISM` so
  serial debug mode stays available.

## Dependencies

- None. All items are independent of in-flight work.
- H-2 requires product-side input on premium-tier policy for catalog
  save + URL import endpoints.

## Risks

- **H-1 fix might touch the session-store API surface** —
  `createSessionStore` is used by multiple callers (`sessions.ts`
  consumers). Changing the contract requires updating all callers and
  their tests. Scope before starting.
- **M-2 fix changes `SkeletonProvider`'s context value shape** —
  `SharedSkeletonBox` consumers outside the repo (none today) would
  break. Keep backward-compatible by exporting the old shape as a
  deprecated alias if needed.
- **M-4 backfill** — adding `NOT NULL` to `dedupeKey` requires a
  one-shot migration over existing `coach_notebook` rows. Write as a
  `server/scripts/backfill-coach-notebook-dedupe.ts` pattern matching
  `backfill-community-meal-types.ts`.

## Related Review

Code review by the `code-reviewer` subagent against
`a7f5c22..HEAD` on 2026-04-17 — 17 commits across 9 todos.

## Updates

### 2026-04-17

- Created from code-review findings on session 2026-04-17 todo orchestrator work.
- Landed: H-1, M-1, M-2, M-3, L-1, L-2, L-3, L-5.
- Deferred:
  - **H-2** — Requires product-side input on premium-tier policy for catalog save / URL import endpoints. Leave for a product sync before coding.
  - **H-3** — Non-blocking polish. The current within-case CI conflates judge noise and cross-case variance; a blocked-bootstrap variant is worth doing but not urgent. Awaiting a dedicated eval-metrics pass.
  - **M-4** — `coach_notebook.dedupeKey` NOT NULL backfill requires a one-shot migration (`backfill-coach-notebook-dedupe.ts` pattern) + schema change + deployment coordination; exceeds the scope of a post-review hardening pass.
  - **L-4** — Non-blocking (`authorId IS NULL | demoUserId` scope already contains blast radius). Re-open when a new test-factory pattern emerges.
  - **L-6** — `pLimit(5)` parallelism for eval runs is a future optimization; serial output is easier to debug today and eval runs are infrequent.

### 2026-04-18

- Cleared the deferred queue via parallel orchestrator run. All 5 items landed; status moved to `done`.
- Landed:
  - **H-2** (`b663764`) — Added `catalogSave` + `urlImport` premium-feature keys to `shared/types/premium.ts` and inserted `checkPremiumFeature` gates in `recipe-catalog.ts` (POST /save) and `recipe-import.ts` (POST /import-url). Added 2 free-tier 403 denial tests + premium-mock backfill on existing happy/error-path tests. **Note:** the dispatched agent worked on a stale `recipes.ts` predating the `bed927e` route split; manually re-applied to the new file layout after the worktree merge revealed the divergence.
  - **H-3 + L-6** (`09e9c93`) — Single agent (same file). Expanded `bootstrapMeanCI` doc + in-aggregator comment to make clear the CI conflates judge noise and cross-case variance (H-3). Added `EVAL_PARALLELISM` env var (1-10, default 1) and replaced the nested for-loop with `Promise.all` over `pLimit(N)`-wrapped tasks; added a `logBuffer` parameter to `evaluateCase` so parallel runs preserve case-order in stdout. Default is unchanged serial behavior (L-6). `CLAUDE.md` updated with the new env var.
  - **M-4** (`abd9ec0`) — Took the **log-warn defense-in-depth path**, not the full migration. Added a `logger.warn` at the top of `createNotebookEntries` that fires once per call when any input lacks `dedupeKey`, with `reason: "coach_notebook.dedupeKey_missing"` for grep-ability and a counter of NULL vs total entries. Insert behavior unchanged. The full backfill+`NOT NULL` migration remains a future trigger when deployment coordination opens up. 3 new tests added to `coach-notebook.test.ts`.
  - **L-4** (`a1eee81`) — Picked path (a) **prefix convention**: cleanup now matches `seed-%` OR `test-%` plus a legacy allowlist for back-compat. Extracted pure classifier `isJunkRecipeName` into `cleanup-seed-recipes-utils.ts` (10 unit tests). Updated all real-DB test fixtures + factories to use the `test-` prefix; teardown now uses ILIKE filter. The `authorId IS NULL | demoUserId` scope guard is preserved. Pattern codified in `docs/patterns/security.md`.
- Verification: 3846/3846 tests passing (baseline was 3831 — +15 from new tests). Types clean. Lint clean (0 errors).
