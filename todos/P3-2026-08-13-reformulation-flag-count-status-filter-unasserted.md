---
title: "getReformulationFlagCount's status filter is unasserted — needs an ownership-scoped count or a serialized window"
status: backlog
priority: low
created: 2026-08-13
updated: 2026-08-13
assignee:
labels: [deferred, testing, database]
github_issue:
---

# getReformulationFlagCount's status filter is unasserted

## Summary

`getReformulationFlagCount` (`server/storage/reformulation.ts:109`) applies
`status ? eq(reformulationFlags.status, status) : undefined`, and no test in the
suite can currently catch that filter being dropped or inverted. Its three tests
in `server/storage/__tests__/reformulation.test.ts` assert **lower bounds** over
owned rows, which a dropped filter satisfies just as well.

## Background

Deferred from the review of PR #804 (`fix/reformulation-offset-test-isolation`),
which replaced flaky before/after count deltas with lower bounds. The deltas
_did_ discriminate the filter, so this is a deliberate, recorded coverage
trade — not an oversight.

The trade was forced. `reformulation_flags` is committed to by
`server/storage/__tests__/verification.concurrent.test.ts`, which deliberately
runs outside the savepoint harness (it needs real distinct pool connections for
a lock race) and bulk-deletes its ~46 `flagged` rows in `afterAll`. Under READ
COMMITTED each statement re-snapshots, so any two-read delta over an unscoped
`count(*)` is unstable in both directions — that was PR #804's original defect.

Catching a dropped/inverted filter requires an **upper** bound on the count, and
no upper bound exists while another worker may commit a row at any moment. The
alternatives were enumerated and rejected during that PR: scoped subtraction, a
three-read sandwich, a status-transition delta, an in-transaction delete of the
foreign rows, and `REPEATABLE READ` (which cannot be set after the transaction's
first statement anyway).

Partial mitigation already in place: `counts rows when no status filter is
given` discriminates when the file runs **alone** (no foreign rows), but not
under the full suite.

## Acceptance Criteria

- [ ] A dropped status filter (`conditions` always `undefined`) makes at least
      one test RED **in the full suite**, not only when the file runs alone
- [ ] An inverted filter (`ne` instead of `eq`) likewise goes RED
- [ ] No before/after delta over an unscoped `count(*)` is reintroduced — that
      is the exact defect PR #804 removed
- [ ] The residual comment at the end of the `getReformulationFlagCount`
      describe block is updated or removed to match whatever lands

## Implementation Notes

Two viable directions, neither in scope for PR #804:

1. **Give the function an ownership-scopable surface.** A production change —
   e.g. an optional barcode-prefix or id-range filter — would let a test count
   only rows it owns and assert an exact number. Only worth it if a production
   caller wants it; do not add a parameter that exists solely for tests.
2. **Serialize the hazard.** Make `verification.concurrent.test.ts` and this
   file non-concurrent so the foreign population is stable for the duration.
   Vitest's file-level parallelism is global (`--no-file-parallelism` slows the
   whole suite), so this needs a narrower mechanism than the blunt flag.

Do NOT "fix" this by asserting the sibling `getReformulationFlags` status tests
cover it — that function declares its own `conditions` local, so exercising one
says nothing about the other (the two-derivations fallacy;
`docs/solutions/conventions/gate-over-two-derivations-of-same-function-is-blind-2026-06-14.md`).

## Scope Contract

- **Files in scope:** `server/storage/__tests__/reformulation.test.ts`, plus
  `server/storage/reformulation.ts` only if direction 1 is chosen and a
  production caller justifies it.
- No vitest config change that slows the whole suite.

## Dependencies

- None.

## Risks

- Direction 1 risks adding a production parameter for test convenience — reject
  unless a real caller needs it.
- Any fix must be verified by forcing the interleaving, not by repetition:
  `npx vitest run server/storage/__tests__/reformulation.test.ts server/storage/__tests__/verification.concurrent.test.ts`
  in a loop, with a mutation check (drop the filter, confirm RED).

## Updates

### 2026-08-13

- Filed from the PR #804 review. See
  `docs/solutions/logic-errors/before-after-delta-over-foreign-writable-table-2026-08-13.md`
  for the full root-cause analysis.
