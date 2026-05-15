---
title: "Shard Vitest suite across CI runners"
status: backlog
priority: low
created: 2026-05-11
updated: 2026-05-11
assignee:
labels: [testing, ci, performance, deferred, audit-2026-05-11]
github_issue:
---

# Shard Vitest suite across CI runners

## Summary

`.github/workflows/ci.yml` runs all ~3400 tests across 328 files in a single sequential job on one `ubuntu-latest` runner. As the suite grows, PR feedback time will degrade. Adopt `vitest --shard=K/N` with a job matrix to parallelize.

## Background

Surfaced by audit 2026-05-11 (finding L4 in `docs/audits/2026-05-11-testing.md`). Not a correctness issue — purely developer experience / CI cost optimization. Defer until either (a) typical CI run exceeds ~8 minutes, or (b) the test count grows another 50%.

## Acceptance Criteria

- [ ] Decide shard count (start with 2 or 3 — gains diminish above 4 for a suite this size with one DB)
- [ ] Update `.github/workflows/ci.yml`: convert the `ci` job to a matrix with `shard: [1, 2, 3]`, add `--shard=${{ matrix.shard }}/${{ strategy.job-total }}` to the test step
- [ ] Each shard needs its own Postgres service (already configured per-job)
- [ ] DB schema push and `pg_trgm` extension must run on each shard
- [ ] Lint + types + pattern scripts can still run as a single non-shard job (they're fast)

## Implementation Notes

- Vitest's `--shard` is file-level; tests within a file run together. If a single test file dominates (e.g., a large auth.test.ts), sharding gains are capped.
- Consider also `pool: "threads"` for faster cold start — currently `pool: "forks"` per `vitest.config.ts:27`
- DB-using tests assume one worker per file (per `test/db-test-utils.ts` module-level state). Per-shard pool isolation must preserve this — don't enable `fileParallelism` or `singleThread`.

## Dependencies

None.

## Risks

- Shard imbalance — one shard may take 2x another's time. Vitest doesn't auto-balance by historical timing. Acceptable as long as max shard time < current total.
- Postgres service startup cost gets paid per shard.
