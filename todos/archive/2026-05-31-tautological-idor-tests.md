---
title: "Replace tautological storage.test.ts IDOR tests with real production-code coverage"
status: done
priority: medium
created: 2026-05-31
updated: 2026-05-31
assignee:
labels: [deferred, testing]
github_issue:
---

# Replace tautological storage.test.ts IDOR tests with real production-code coverage

## Summary

The `IDOR Protection` and `Saved Items` describe blocks in `server/__tests__/storage.test.ts` test nothing in production code — they define the ownership-check logic inline in the test body and call `vi.fn()` stubs directly. These give false CI confidence that IDOR protections work when they actually exercise zero storage functions. Fix: delete the tautological tests and replace with storage-function tests that call real implementations against an in-memory or test-DB fixture.

## Background

Surfaced by `/audit code-quality` on 2026-05-31 as finding H1 (High).

- Lines 405–429 (`IDOR Protection`): `const hasAccess = item.userId === requestingUserId; expect(hasAccess).toBe(false)` — the logic being "tested" is written inline in the test body. No storage function is called.
- Lines 431–485 (`Saved Items`): `const mockGetSavedItems = vi.fn().mockResolvedValue([]); const result = await mockGetSavedItems(...)` — mocking the SUT and asserting the mock's own return value.

This is the SUT-mock antipattern identified in `docs/rules/testing.md`. The 2026-05-11 testing audit flagged an _absence_ of coverage; this finding is about _presence of misleading green tests_.

Also bundled: **L1** — `generateAndPatchRecipeImage` absent from the `recipe-generation` mock factory in `server/routes/__tests__/recipes.test.ts:47–50`. The route calls it via `fireAndForget` but it's not in the factory, so it resolves to `undefined` and throws silently. Fix: add `generateAndPatchRecipeImage: vi.fn()` to the mock factory. Optionally assert it was called (or not) in the generate-recipe test.

## Acceptance Criteria

- [ ] `IDOR Protection` describe block (lines 405–429) is deleted or replaced with tests that call actual storage functions (e.g. `storage.getSavedItems` from a test that confirms only the owning user's items are returned)
- [ ] `Saved Items` describe block (lines 431–485) is deleted or replaced with tests that call actual storage functions; if real DB tests are not feasible, the tests are removed rather than kept misleadingly green
- [ ] `generateAndPatchRecipeImage: vi.fn()` added to the `recipe-generation` mock factory in `server/routes/__tests__/recipes.test.ts:47–50`
- [ ] The `POST /api/recipes/generate` test asserts `generateAndPatchRecipeImage` was called (via `expect(vi.mocked(generateAndPatchRecipeImage)).toHaveBeenCalled()`)
- [ ] All existing tests still pass; no net reduction in real coverage

## Implementation Notes

The existing storage tests at `server/__tests__/storage.test.ts` use `vi.mock` to stub collaborators — they do not spin up a real DB. For the IDOR block to have real value it needs to call actual storage functions like `storage.getSavedItems(userId)` with a mocked DB that returns rows owned by a different user, and assert the storage function correctly filters or throws. If the storage functions already enforce `AND user_id = ?` in their queries (they do, via Drizzle `where(eq(table.userId, userId))` clauses), a doc-test showing the correct Drizzle pattern is more valuable than a stub-call test.

The previous testing audit (2026-05-11) noted that storage coverage should be expanded; this is the same gap from a different angle.

For L1: the `fireAndForget` call is fire-and-forget, so asserting it was _called_ (not the resolved value) is the right check.

## Dependencies

- None

## Risks

- Rewriting the IDOR block to call real storage functions may require mock-DB setup that doesn't exist yet; if that's the case, deleting the misleading tests is better than leaving them
- CLAUDE.md rule: "we got burned last quarter when mocked tests passed but the prod migration failed" — don't mock the DB for these tests if a real-schema test fixture is available

## Updates

### 2026-05-31

- Created from `/audit code-quality` 2026-05-31 findings H1, L1
