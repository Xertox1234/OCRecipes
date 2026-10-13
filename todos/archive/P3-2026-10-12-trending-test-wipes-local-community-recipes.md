---
title: "The trending-terms test deletes every local community recipe on each test run"
status: done
priority: low
created: 2026-10-12
updated: 2026-10-12
assignee:
labels: [deferred, testing]
github_issue:
---

# The trending-terms test deletes every local community recipe

## Summary

`server/storage/__tests__/community-recipes-trending.test.ts` runs `DELETE FROM community_recipes` before each test. Tests run against the local dev database (`test/setup.ts` only refuses non-local URLs), so every full `npm run test:run` wipes the seeded recipes and leaves three fixture rows titled "t".

## Background

Found on 2026-10-12 while checking PR #1408 in the simulator. After the `/todo` baseline run and the executor's test run, the local DB had only 3 community recipes, all titled "t", created at 13:39 during the test run. The 25 seeded recipes were gone. As a result:

- RecipeBrowser showed a lone "t" card that opens as "Recipe not found".
- Home's For You carousel was empty.

The fix for now is `SEED_DEMO_PASSWORD=demo-password-2026 npm run seed:recipes` plus a server restart, because the recipe search index is built at boot. It is the only unscoped `DELETE` in the server tests (`grep -rn "DELETE FROM" server --include='*.test.ts' | grep -v WHERE`). The test has been like this since #470.

## Acceptance Criteria

- [x] A full test run leaves existing local `community_recipes` rows in place.
- [x] The trending test still tests ranking without depending on rows it didn't create. For example, scope its fixtures with a unique `normalizedProductName` and delete only those, or run it in a transaction that is rolled back.
- [x] No fixture rows are left behind after the test file finishes.

## Implementation Notes

- File: `server/storage/__tests__/community-recipes-trending.test.ts`. The `beforeEach` at `:18-20` and `insertRecipe` at `:7-15`.
- `getTrendingSearchTerms` (`server/storage/community-recipes.ts`) aggregates over all public rows, so the assertions must still hold with seeded rows present. Either filter the result to the fixture terms or use a transaction rollback.

## Scope Contract

- **Files in scope:** `server/storage/__tests__/community-recipes-trending.test.ts`; a test-only helper if one is needed.
- No change to production code.

## Dependencies

- None.

## Risks

- Low. Test-only change.

## Updates

### 2026-10-12

- Filed while checking PR #1408 in the simulator.

### 2026-10-12 (done)

- Fixtures now use terms unique to the run (`trending-test-<uuid>-…`) and scores of 50M–1B, far above any real recipe (local max is 100). `afterEach` deletes only rows with this run's `normalizedProductName`. The table-wide `DELETE` is gone.
- The private fixture has the highest score, so it would rank first if the public-only filter broke. The test asserts the exact top three.
- Evidence (local DB): 28 rows before and 28 after a run, 0 leftover fixtures. Control: with `is_public = true` removed from the diet-tag branch, the test fails with the private term in the result, and still leaves 0 rows behind.
- No other table-wide `DELETE FROM` in server or test `*.test.ts` files.
