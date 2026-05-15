---
title: "Test hygiene improvements from 2026-04-18 audit"
status: done
priority: medium
created: 2026-04-18
updated: 2026-04-18
archived: 2026-04-18
labels: [testing, code-quality, audit-2026-04-18]
---

# Test hygiene improvements from 2026-04-18 audit

## Summary

Eleven findings across test isolation, mock quality, factory usage, timer handling, and coverage gaps. Tests currently pass but carry latent ordering dependencies and hidden type drift.

## Findings (cross-ref `docs/audits/2026-04-18-full.md`)

### Global-state / isolation

- **M34** — `coachProInternals.lastArchivedAt` Map never cleared in `beforeEach` of `handleCoachChat` test block. All tests use `userId: "user-42"` — later tests silently skip archive branch. Add `coachProInternals.lastArchivedAt.clear()` to outer `beforeEach`.
- **L22** — `concurrent initSearchIndex` race test actually calls `resetSearchIndex` in both `beforeEach` AND test body — not genuinely racy. Move reset to the outermost describe.

### Mock + factory quality

- **M35** — `asMockReturn<T>(value: Partial<T>): T { return value as T }` — plain cast defeats factory pattern; used ~10×. Catch schema drift.
- **M36** — `coach-context.test.ts` inlines full `User`/`UserProfile`/`CoachNotebookEntry`/`ChatConversation` objects 3× instead of using existing factories.
- **L23** — `recipes.test.ts` mocks `CatalogQuotaError` as a fresh class — `instanceof` checks at route boundary would fail. Use `importActual` pattern.
- **L24** — `coach-pro-chat.test.ts` userId-cache-regression test is redundant with the pure `hashCoachCacheKey` tests; stronger assertion through direct pure-fn calls.
- **L25** — `community.test.ts` / `meal-plans.test.ts` use `featured.some(r => r.title === X)` — can't detect extra unexpected recipes.

### Timing

- **M37** — `weight-trend.test.ts` uses `makeWeightEntry(weight, daysAgo)` with `new Date()` at call time — DST / midnight-UTC buckets entries wrong. Use `vi.useFakeTimers()` + `vi.setSystemTime()`.
- **M38** — `chat.test.ts:166-178` uses `setTimeout(r, 10)` to force timestamp gap before `>=` assertion (tautological). Drop sleep, assert `>` strict.

### Coverage gaps

- **M39** — `backfillMealTypes`, `server/lib/meal-type-inference.ts`, and `server/routes/_recipe-helpers.ts` have no direct tests — only covered indirectly.
- **L26** — `check-eval-dataset-secrets.test.ts` `mkdtempSync` temp dirs never cleaned — `/tmp/eval-secrets-check-*` accumulates on CI runners.

## Acceptance Criteria

- [x] `coachProInternals.lastArchivedAt.clear()` in outer beforeEach
- [x] Race test moved to outermost describe
- [x] `asMockReturn<T>` replaced with typed factories
- [x] `coach-context.test.ts` migrated to factories
- [x] `CatalogQuotaError` mock uses `importActual`
- [x] Cache regression redundancy removed
- [x] `.some(r => r.title === X)` → exact count assertions
- [x] weight-trend tests use fake timers
- [x] chat.test.ts timestamp tautology fixed
- [x] Direct tests for `backfillMealTypes`, `meal-type-inference`, `_recipe-helpers`
- [x] Temp dir cleanup in eval secrets test

## Updates

### 2026-04-18

- Created from 2026-04-18 audit deferrals.

### 2026-04-18

- All 11 findings implemented and verified. Committed as `6f5e080` on branch `worktree-agent-a6868b57`.
- Added `createMockCoachNotebookEntry` factory to `server/__tests__/factories/chat.ts`.
- New test files: `server/routes/__tests__/_recipe-helpers.test.ts`, `server/services/__tests__/backfill-meal-types.test.ts`.
- 193 unit tests pass across 8 affected test files. TypeScript clean. Lint clean.
