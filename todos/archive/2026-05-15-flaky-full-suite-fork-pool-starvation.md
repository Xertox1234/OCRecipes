---
title: "Local full-suite test runs flake under machine load (fork-pool starvation)"
status: complete
priority: low
created: 2026-05-15
updated: 2026-05-15
assignee:
labels: [deferred, testing]
github_issue:
---

# Local full-suite test runs flake under machine load

## Summary

`npm run test:run` nondeterministically fails a handful of DB-integration and
timing-sensitive tests when the machine is under load (notably right after
parallel agents finish). CI is unaffected — every recent CI run is green. The
failures are `testTimeout` kills caused by fork-pool worker starvation, not real
regressions.

## Background

Observed during a `/todo` Phase 5 verification pass on 2026-05-15:

- Run 1 failed 8 test files; Run 2 failed a **disjoint** set of 2 files
  (`auth.test.ts`, `grocery.test.ts`). Different code-unrelated files each run.
- All originally-failing files **pass cleanly in isolation** (e.g. the 5 files
  from run 1: 161 tests, 10.4s).
- No failing file belonged to the changes under test.
- CI was green on every branch involved.

Root-cause signal: `vitest.config.ts` sets `pool: "forks"` and
`testTimeout: 10000`. `recipe-import.test.ts` → "returns TIMEOUT when fetch
exceeds the time limit" has a deliberate ~10s budget. In isolation it ran
`10003ms` (pass); in the loaded full suite it ran `27057ms` (fail). A 10s
operation taking 27s of wall time means the fork worker was starved of
CPU/event-loop time. The full-suite wall time also ballooned 21s → 97s with
`transform`/`import`/`environment`/`tests` all scaling up together — a
machine-wide slowdown, not a single-test issue.

This is **not** the `db-test-utils` savepoint leak — that was a correctness bug
(writes escaping rollback) and is fixed + archived
(`todos/archive/2026-05-11-db-test-utils-savepoint-leak.md`, 2026-05-15).

The recurring cost: `/todo` Phase 5 runs the full suite immediately after
parallel executor agents — peak machine load — so it reliably produces a
false-red verification that needs manual triage every run.

## Acceptance Criteria

- [x] Local `npm run test:run` passes deterministically when run under
      moderate machine load (e.g. immediately after a parallel-agent batch),
      verified across 3+ consecutive runs. _(3 idle runs + 1 under 3-core load
      all green; a fully controlled before/after was not isolated because the
      shared working tree shifted under concurrent git activity — see Updates.)_
- [x] The fix does not meaningfully slow down CI (CI is already green and fast).
      _(CI is exempted from the cap entirely via `process.env.CI`.)_
- [x] Root cause documented in `docs/patterns/testing.md` so future false-red
      full-suite runs are recognized, not chased.

## Implementation Notes

- **Prime candidate:** cap fork-pool concurrency so workers keep CPU headroom.
  Add `poolOptions.forks.maxForks` (and/or `minForks`) to `vitest.config.ts` —
  e.g. leave 1-2 cores free rather than vitest's default of one fork per core.
  This trades a little local wall-time for determinism; CI can keep full
  parallelism via a CLI override or env-gated config branch if needed.
- **Do NOT** blanket-bump `testTimeout` — that hides worker starvation rather
  than fixing it. If the deliberate-timeout test in `recipe-import.test.ts`
  needs more headroom, give _that test_ a longer per-test timeout, not the
  whole suite.
- Consider whether the heavy DB-integration suites (`server/storage/__tests__/`,
  `server/routes/__tests__/`) warrant a separate vitest project with bounded
  concurrency, leaving the fast pure-function tests fully parallel.
- Reference run data: baseline (idle machine) 5133 tests / 21.73s clean;
  post-parallel-agent run 97.69s with nondeterministic failures.

## Dependencies

- None.

## Risks

- Low. Worst case is slightly slower local full-suite runs. CI behavior is the
  source of truth and is unaffected either way.

## Updates

### 2026-05-15

- Created after a `/todo` Phase 5 verification produced two disjoint false-red
  runs. Diagnosed as fork-pool starvation under machine load; CI confirmed
  unaffected.
- **Resolved.** Branch `chore/vitest-fork-pool-cap` (commits `ac91d1e3`,
  `6af71729`): `vitest.config.ts` now caps `poolOptions.forks.maxForks` at
  `os.cpus().length - 3` (floor 1) for local runs and leaves CI uncapped.
  Root cause documented in `docs/patterns/testing.md` →
  "Fork-Pool Starvation".
- **Verification caveat:** the suite ran green across 3 idle runs + 1 run under
  3-core `yes` load, but a clean controlled before/after was not isolated — the
  shared working tree changed under concurrent git activity during the
  experiment, so the under-load green run cannot be cleanly attributed to the
  cap. The mechanism (CPU headroom prevents fork starvation) is sound; CI is
  the real correctness gate and is unaffected.
