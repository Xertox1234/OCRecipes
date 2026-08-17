---
title: A half-open `[from, to)` range excludes a row tied with `to` — and a HAVING floor can vanish the whole group
track: bug
category: logic-errors
tags: [database, testing, timestamps, boundary, drizzle, postgres]
module: server
applies_to: ["server/storage/**/*.ts", "server/storage/**/__tests__/**/*.ts"]
symptoms: ["an aggregate query with gte(col, from)/lt(col, to) intermittently returns fewer rows or a group vanishes entirely, only under full-suite runs (never isolated -t filtered runs)", "a test that inserts a row via daysAgo(0) or similar and immediately queries with to = new Date() fails ~1 run in N, always with the SAME group/row missing", "the failure disappears under vitest's default retry: N config and only reproduces with --retry 0", "a HAVING count(*) >= K clause makes the failure look like the whole entity is missing, not merely undercounted by one"]
created: 2026-08-16
severity: medium
---

# A half-open `[from, to)` range excludes a row tied with `to` — and a HAVING floor can vanish the whole group

## Problem

A query scopes a time window with `gte(col, from)` + `lt(col, to)` (half-open: inclusive
start, exclusive end). Both `from`/`to` and the row's timestamp are computed from
`Date.now()`/`new Date()` at different points in the same synchronous call chain — a row is
inserted with a `daysAgo(0)`-style "now" timestamp, then `to = new Date()` is computed later
in the same function, intended to be "at least as late as everything just inserted." When
the surrounding code runs fast enough (full test-suite runs, already-warmed connections,
no import overhead — NOT isolated single-test runs, which have enough overhead to keep the
two timestamps apart), the two `Date` calls can land in the **same millisecond**. JS `Date`
has millisecond resolution; there is no sub-millisecond tiebreak. The row's timestamp and
`to` compare **equal**, and the strict `lt(col, to)` excludes a row that is legitimately "in
the window."

## Symptoms

- An aggregate/count query intermittently returns a lower count, or an entire group missing,
  with a probabilistic rate (e.g. "~1 failure in 4 runs") that does not reproduce when the
  single test is run in isolation with a `-t`/`--testNamePattern` filter — isolation adds
  enough overhead (module import, fresh connection) to keep the two `Date` calls apart.
- Reproduces reliably under the **full, unfiltered** test file (`npx vitest run <file>`,
  not `<file> -t "<name>"`) because sibling tests warm up connections/imports first, making
  later tests fast enough to trigger the millisecond tie.
- Vitest's project-wide `retry: N` (see `vitest.config.ts`, added for a *different*,
  CPU-contention flake class) silently absorbs this failure too — **always use `--retry 0`**
  when investigating a suspected boundary-tie flake, or the race self-heals on retry and you
  never see it.
- If the query has a `HAVING count(*) >= K` noise floor, dropping ONE row at the boundary can
  push a real group below `K` and vanish it from the result set ENTIRELY (`[]` instead of a
  merely-short list) — the assertion failure looks like total data loss, not an off-by-one.

## Root Cause

Two `Date`/`Date.now()` calls made close together in wall-clock time are not guaranteed to
differ — JS `Date` truncates to milliseconds, and a fast synchronous chain (test setup with
warmed connections, or a hot production code path) can execute multiple statements inside
one millisecond. A half-open range predicate (`lt`, not `lte`) treats "logged at exactly the
query's `to` instant" as **outside** the window, even though intuitively a row logged at the
exact instant a query says "up to now" should count.

This is a genuine race, not a test artifact: any production caller that computes `to = new
Date()` and queries logs that could be written in the same millisecond (a fast batch job, a
cron tick, a synchronous request handler) has the identical exposure — the flake surfaced it
via tests, but the underlying predicate is buggy independent of tests.

## Solution

1. **Reproduce with `--retry 0` on the full, unfiltered test file first** — never trust an
   isolated `-t`-filtered run's pass rate; it can be systematically slower and never trigger
   the race. If the project has a global `retry:` in `vitest.config.ts`, it will hide this
   class of bug from a default `npm run test:run`.
2. **Print the actual timestamps from a failing run** before touching the predicate — insert
   temporary instrumentation that logs the row's stored timestamp and the query's bound
   side-by-side (`.getTime()`, not just the object) on the failure path. Confirming `delta ===
   0` between the two is the evidence that distinguishes this bug from a different flake
   class (e.g. shared-table contention — see `before-after-delta-over-foreign-writable-table-2026-08-13.md`,
   a similarly-probabilistic but mechanistically unrelated failure in the same DB-test
   family).
3. **Decide deliberately between `lte` and widening the test's window** — do not reach for
   `lte` reflexively. Check EVERY other caller of the changed range predicate for
   tiling/adjacency: if the same `to` value is ever used as another window's `from` (e.g.
   consecutive day buckets from `getDayBounds`), switching to `lte` double-counts the row at
   the seam. Only change the predicate when the function has no tiled/adjacent caller — verify
   this by grepping every call site, not by assuming.
4. **Write a deterministic pinned regression test, not a repeated-run one.** Capture a single
   `const at = new Date()`, insert a row with `loggedAt: at`, and pass the SAME `at` as the
   query's `to`. This asserts the tie case with zero clock race — it either always passes
   (predicate correct) or always fails (predicate still buggy), unlike a "run it 20 times"
   check which only estimates a probability. Confirm the new test REDS against the original
   predicate (negative control) before applying the fix, then GREENS after.
5. **20 consecutive green full-file runs with `--retry 0`** is a reasonable confidence bar for
   the FLAKE going away, but the deterministic pinned test from step 4 is the actual proof —
   the repeated-run count is corroborating, not load-bearing, since the fix is a structural
   predicate change (`loggedAt <= to` always holds once wall-clock time only moves forward),
   not itself timing-dependent.

## Prevention

- Any new `gte(col, from)` / `lt(col, to)` range predicate where `to` is computed from
  "now" at call time (not a stable calendar boundary like `getDayBounds`'s `endOfDay`) should
  default to asking: is this window ever tiled against an adjacent one? If not, prefer `lte`
  from the start — a row logged at exactly "now" is a row logged now.
- Calendar-bucketed boundaries (`startOfDay`/`endOfDay` from a `getDayBounds`-style helper)
  are a DIFFERENT case — they DO tile day-to-day, and switching those to `lte` would
  double-count a row logged at exactly midnight in both adjacent days. Do not "fix" a
  half-open calendar boundary to match a fixed same-file "now" boundary without checking
  BOTH kinds of caller.
- A `HAVING count(*) >= K` floor turns any off-by-one undercount bug into a full-group-vanish
  bug — when debugging "result went from expected to `[]`", check whether a noise floor is
  amplifying a smaller miscount before assuming the whole query is broken.

## Related Files

- `server/storage/nutrition.ts` — `getMostEatenFoods` (fixed: `lt` → `lte`); `getDailyLogsInRange`
  shares the identical shape and the identical `today` call-site object but was deliberately
  left half-open (out of scope, lower severity — no `HAVING` floor to amplify it). Surfaced
  in code review as a deferred item for the user to triage, not filed as a follow-up todo.
- `server/storage/__tests__/nutrition.test.ts` — the deterministic pinned regression test
  ("counts a log written at exactly the `to` boundary").
- `server/services/coach-pro-chat.ts` — the single production caller (`today = new Date()`
  shared by both `getMostEatenFoods` and `getDailyLogsInRange` calls in the same `Promise.all`).
- `vitest.config.ts` — the project-wide `retry: 2` that silently absorbs this flake class
  unless investigated with `--retry 0`.

## See Also

- [before-after-delta over a foreign writable table](before-after-delta-over-foreign-writable-table-2026-08-13.md) — a different, similarly-probabilistic DB-test flake mechanism (shared-table contention, not a clock tie); useful for distinguishing which class a given intermittent DB test belongs to before diagnosing.
- [CURRENT_TIMESTAMP is fixed at transaction start](current-timestamp-fixed-at-transaction-start-2026-05-13.md) — a related but distinct timestamp-tie hazard: postgres's own `CURRENT_TIMESTAMP`/`now()` freezing per-transaction, versus this doc's app-computed `new Date()` calls tying across two separate JS statements.
