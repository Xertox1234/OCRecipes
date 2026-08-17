---
title: "getMostEatenFoods test is intermittent (~1 failure in 4 runs) — suspect the lt() upper bound on loggedAt"
status: backlog
priority: medium
created: 2026-08-16
updated: 2026-08-16
assignee:
labels: [testing, flakiness, database]
github_issue:
---

# An intermittent test in the nutrition storage suite

## Summary

`server/storage/__tests__/nutrition.test.ts` → `describe("getMostEatenFoods")` (starts at
`:1118`) fails roughly one run in four. Pre-existing, not introduced by any 2026-08 change.
The leading hypothesis is a millisecond boundary: the query uses a half-open range whose upper
bound can land on the same millisecond as a row the test just inserted.

## Background

Verified on `main` 2026-08-16:

```ts
// server/storage/nutrition.ts:342-343
gte(dailyLogs.loggedAt, from),
lt(dailyLogs.loggedAt, to),
```

The range is half-open — `[from, to)` — so a row written at exactly `to` is EXCLUDED. If the
test derives `to` from something like "now" and inserts a row in the same millisecond, the row
falls outside the window and the expected aggregate is short by one. Timing-dependent, which
matches the observed intermittency.

**This is a hypothesis, not a diagnosis.** It was formed by reading the predicate, and this
repo's own recent experience is that reading is where wrong conclusions come from. Confirm it
by reproducing before changing anything.

Note the repo already resolved a _different_ flakiness class by adding `retry: 2` for CPU
contention (see the `project_test_suite_flakiness` auto-memory) — that fix is not this bug, and
"add a retry" is explicitly NOT the acceptance criterion here. A boundary bug that a retry
papers over is still a boundary bug, and the same `lt()` shape may affect real callers.

## Acceptance Criteria

- [ ] Reproduce deterministically first — e.g. run the single test in a loop until it fails,
      or pin the clock — and record the actual failure output in this file. Do not fix on the
      hypothesis alone
- [ ] Confirm or refute the `lt()` boundary explanation with evidence (the inserted
      `loggedAt` and the computed `to`, printed side by side from a failing run)
- [ ] Fix the CAUSE. If it is the boundary, decide deliberately between widening the test's
      window and changing the predicate to `lte` — and if the predicate changes, check every
      other caller of that range, because a half-open range is usually intentional
- [ ] 20 consecutive green runs of that describe block
- [ ] `retry:` is not used to make this pass
- [ ] Closes with zero follow-ups

## Implementation Notes

- The test needs a live Postgres (`postgresql://localhost/nutricam` per the dev-DB memory);
  this is not a DB-free leaf.
- If the cause turns out to be shared-table contention with a sibling test file rather than the
  boundary, `docs/solutions/logic-errors/before-after-delta-over-foreign-writable-table-2026-08-13.md`
  is the codified precedent and the fix shape differs — check it before assuming the boundary.
- Keep the change minimal: this is a flake hunt, not a refactor of the aggregate.

## Scope Contract

- **Mechanisms to use:** the existing Vitest file and the existing query builder — no new test
  harness, no new fixture framework, no `retry` configuration
- **Files in scope:** `server/storage/__tests__/nutrition.test.ts`, and
  `server/storage/nutrition.ts` only if the predicate itself is the confirmed cause
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- A reachable local Postgres.

## Risks

- **Chasing the wrong cause.** A ~25% failure rate is easy to "fix" by accident — a change that
  perturbs timing can look like a fix for several runs. The 20-consecutive-green criterion
  exists for that reason, and even it is weak evidence without a confirmed root cause.
- If the predicate changes, a half-open → closed range can double-count at the seam between two
  adjacent windows. Check the callers.

## Updates

### 2026-08-16

- Filed at the user's request after being surfaced (and deliberately not auto-filed) during the
  #833–#848 review round. The `gte`/`lt` pair and the test location were verified against
  `main`; the causal link between them and the flake was NOT — that is the first acceptance
  criterion.
