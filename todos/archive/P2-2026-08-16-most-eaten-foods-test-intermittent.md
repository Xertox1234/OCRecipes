---
title: "getMostEatenFoods test is intermittent (~1 failure in 4 runs) — suspect the lt() upper bound on loggedAt"
status: done
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

- [x] Reproduce deterministically first — e.g. run the single test in a loop until it fails,
      or pin the clock — and record the actual failure output in this file. Do not fix on the
      hypothesis alone
- [x] Confirm or refute the `lt()` boundary explanation with evidence (the inserted
      `loggedAt` and the computed `to`, printed side by side from a failing run)
- [x] Fix the CAUSE. If it is the boundary, decide deliberately between widening the test's
      window and changing the predicate to `lte` — and if the predicate changes, check every
      other caller of that range, because a half-open range is usually intentional
- [x] 20 consecutive green runs of that describe block
- [x] `retry:` is not used to make this pass
- [x] Closes with zero follow-ups

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

### 2026-08-16 (execution)

- **Reproduction.** 30 isolated runs of `npx vitest run server/storage/__tests__/nutrition.test.ts
-t "getMostEatenFoods" --retry 0` passed 30/30 — the flake did not appear filtered/isolated.
  Switching to the FULL unfiltered file (`npx vitest run
server/storage/__tests__/nutrition.test.ts --retry 0`, `--retry 0` required because
  `vitest.config.ts` sets a global `retry: 2` that silently absorbs the flake) reproduced on the
  1st run of one 20-run loop and the 8th run of a second 15-run loop — the failure needs the full
  file's faster inter-test timing (already-warmed connections/imports), not isolation. Failing
  test: `nutrition storage > getMostEatenFoods > excludes discarded scanned items and does not
leak other users' logs`:

  ```
  AssertionError: expected [] to deeply equal [ { name: 'Other User Food', …(1) } ]
  - Expected
  + Received
  - [
  -   { "name": "Other User Food", "timesLogged": 3 },
  - ]
  + []
   ❯ server/storage/__tests__/nutrition.test.ts:1198:27
  ```

- **Confirmed (not refuted) the `lt()` boundary explanation.** Temporary instrumentation printed
  the 3 inserted `loggedAt` values and the `to` argument from the failing run, side by side:

  ```
  DEBUG_BOUNDARY {"loggedTimesMs":[1786936078974,1786849678974,1786763278974],
  "toMs":1786936078974,"toISO":"2026-08-17T03:07:58.974Z",
  "loggedISO":["2026-08-17T03:07:58.974Z","2026-08-16T03:07:58.974Z","2026-08-15T03:07:58.974Z"],
  "deltas":[0,86400000,172800000]}
  ```

  The most-recent row's `loggedAt` and the query's `to` are the IDENTICAL millisecond
  (`1786936078974`, delta 0). The half-open `lt(loggedAt, to)` excludes a row tied with `to`,
  dropping that food's count from 3 to 2 — below the `HAVING count(*) >= 3` noise floor — so the
  food vanishes from the result entirely (`[]`) instead of merely undercounting. This is the exact
  mechanism the todo hypothesized.

- **Fix (deliberate choice, per the todo's decision point).** Changed the predicate in
  `getMostEatenFoods` (`server/storage/nutrition.ts`) from `lt(dailyLogs.loggedAt, to)` to
  `lte(dailyLogs.loggedAt, to)` — NOT a widened test window — because the todo's own framing
  ("the same `lt()` shape may affect real callers") points at the production predicate, and a
  row logged at exactly `to` ("now") is legitimately "logged now" and should count. Checked
  every caller of the range per the risk note: `getMostEatenFoods` has exactly one caller
  (`coach-pro-chat.ts:562`, `storage.getMostEatenFoods(userId, thirtyDaysAgo, today)`) using a
  single one-off lookback window — `today` is not the `from` of any adjacent/tiled window, so
  making the end inclusive cannot double-count at a seam. Left the day-bucket functions
  (`getDailyLogs`, `getDailySummary`, both using `getDayBounds` boundaries that DO tile
  day-to-day) and the sibling `getDailyLogsInRange` (same `lt` shape, same `today` call site,
  but zero observed failures and out of this todo's Scope Contract) untouched. Both
  `code-reviewer` and `server-reviewer` independently flagged this as a real, lower-severity
  (no `HAVING` floor to amplify it) deferred item during review — filed per CLAUDE.md's
  low-severity auto-file policy as
  `todos/P3-2026-08-16-getdailylogsinrange-boundary-tie.md`, not left as an unfiled
  observation.

- **TDD.** Added a deterministic pinned regression test (`counts a log written at exactly the
\`to\` boundary (window end is inclusive)`) to the `getMostEatenFoods`describe block —
inserts 2 logs strictly inside the window plus 1 log timestamped at exactly`to`, asserts
`timesLogged: 3`. No clock race: confirmed it REDS against the original `lt`predicate
(negative control), then confirmed it GREENS after the`lte` fix.

- **20 consecutive green runs.** `npx vitest run server/storage/__tests__/nutrition.test.ts
--retry 0` × 20 (the unfiltered full-file configuration that actually reproduced the bug,
  not the isolated `-t` filter that never did) — 0 failures. `retry:` was not used to mask
  anything; verification ran with `--retry 0` throughout.

- Closes with no follow-ups on THIS function: `getMostEatenFoods` is fully fixed, verified,
  and needs no further work. `getDailyLogsInRange`'s identical-shaped, lower-severity,
  unconfirmed tie is tracked separately at
  `todos/P3-2026-08-16-getdailylogsinrange-boundary-tie.md` (low-severity, auto-filed per
  CLAUDE.md — not a reopening of this todo).
