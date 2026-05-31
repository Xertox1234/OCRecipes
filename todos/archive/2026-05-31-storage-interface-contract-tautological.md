---
title: "Replace/remove tautological Storage Interface Contract block in storage.test.ts"
status: done
priority: low
created: 2026-05-31
updated: 2026-05-31
assignee:
labels: [deferred, testing]
github_issue:
---

# Tautological Storage Interface Contract block

## Summary

The `Storage Interface Contract` describe block near the top of `server/__tests__/storage.test.ts` (e.g. `getUser` / `getUserByUsername` / `createUser`) is the same SUT-mock antipattern PR #294 removed from the `IDOR Protection` and `Saved Items` blocks: it mocks every storage function inline and asserts the mock's own return value, exercising zero production code. Delete it or replace it with tests that call real storage functions.

## Background

Surfaced while completing PR #294 (`2026-05-31-tautological-idor-tests`), which was scoped to only the two named blocks and correctly left this one untouched. It gives false CI confidence that the storage interface works when it runs ~0% of production code (see `docs/rules/testing.md` — "Never `vi.mock()` the module under test itself").

## Acceptance Criteria

- [ ] The `Storage Interface Contract` describe block is deleted, OR replaced with tests that import and call the real storage functions against the project's real-DB test fixture (mirroring `server/storage/__tests__/*.test.ts`).
- [ ] If real-DB coverage for these functions already exists elsewhere (verify first, as #294 did for the IDOR case), prefer deletion over a redundant rewrite.
- [ ] No net reduction in _real_ coverage; all existing tests pass.

## Implementation Notes

- File: `server/__tests__/storage.test.ts`, the `Storage Interface Contract` describe block.
- First check whether `getUser` / `getUserByUsername` / `createUser` are already covered against a real fixture in `server/storage/__tests__/users.test.ts` (PR #294 found the saved-items functions were already covered in `nutrition.test.ts`, making deletion the right call).
- Do NOT mock the DB for any replacement tests — use the real-schema test fixture (CLAUDE.md: mocked tests that passed while the real migration failed is the failure mode this rule prevents).

## Dependencies

- None (PR #294 merged the sibling cleanup).

## Risks

- If no real-DB coverage exists and a fixture rewrite is non-trivial, deletion is acceptable — a misleading green test is worse than an absent one.

## Updates

### 2026-05-31

- Created from the `tautological-idor-tests` (PR #294) out-of-scope observation during `/todo` deferred-warning triage.
