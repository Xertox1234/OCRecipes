---
title: "Replace/remove tautological Date Range Calculations block in storage.test.ts"
status: backlog
priority: low
created: 2026-05-31
updated: 2026-05-31
assignee:
labels: [deferred, testing]
github_issue:
---

# Tautological Date Range Calculations block in storage.test.ts

## Summary

The `Date Range Calculations` describe block in `server/__tests__/storage.test.ts` re-implements date logic inline (e.g. `setHours(...)` then asserts the same computation) and exercises zero production code — the same mild SUT/tautology antipattern that PR #294 and the `2026-05-31-storage-interface-contract-tautological` cleanup (PR #309) removed from sibling blocks in this file. Either delete it or point it at the real date-range helper it's meant to cover.

## Background

Surfaced during the `2026-05-31-storage-interface-contract-tautological` todo (PR #309), which was scoped to only the `Storage Interface Contract` block and correctly left this one untouched. The block gives false CI confidence: a passing test that runs no production code (see `docs/rules/testing.md` — a test that re-implements the logic it claims to verify proves nothing).

## Acceptance Criteria

- [ ] Identify the production date-range helper these tests are nominally about (search `server/storage/` and `server/services/` for the real `setHours`/day-boundary logic — likely the daily-summary / daily-log range computation).
- [ ] Either (a) rewrite the block to import and call the real helper, OR (b) delete the block if the real logic is already covered against a real fixture elsewhere (mirror how PR #294 / #309 chose deletion after confirming real-DB coverage exists).
- [ ] No net reduction in _real_ coverage; all existing tests pass.

## Implementation Notes

- File: `server/__tests__/storage.test.ts`, the `Date Range Calculations` describe block (sits near the now-removed `Storage Interface Contract` block; the `escapeLike` block in the same file is fine — it tests a real util).
- First check whether the actual day-boundary logic is already covered in `server/storage/__tests__/nutrition.test.ts` (which holds the daily-summary / daily-log real-DB tests) — if so, deletion is the right call.
- Do NOT mock the DB for any replacement tests — use the real-schema test fixture.

## Dependencies

- Follows PR #309 (`todos/archive/2026-05-31-storage-interface-contract-tautological.md`). Not blocking.

## Risks

- Low. If no real coverage exists and a fixture rewrite is non-trivial, deletion is acceptable — a misleading green test is worse than an absent one.

## Updates

### 2026-05-31

- Filed from the PR #309 deferred observation during `/todo` deferred-warning triage.
