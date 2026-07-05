<!-- Filename: P3-2026-07-05-pg-git-history-mining.md -->

---

title: "PG Lab: git history mining — churn hotspots and co-change coupling"
status: backlog
priority: low
created: 2026-07-05
updated: 2026-07-05
assignee:
labels: [deferred, harness]
github_issue:

---

# PG Lab: git history mining — churn hotspots and co-change coupling

## Summary

Import `git log --numstat` into `repo.commits` / `repo.file_changes` and ship canned queries for churn hotspots and co-change coupling ("these two files change together N% of the time"), which git itself answers badly.

## Background

Master plan: `docs/research/2026-07-05-pg-lab-roadmap.md`. Co-change coupling is a documented trap in this repo — the InsertUser `.pick()` decoupling memory is exactly a "these files must change together but nothing says so" bug. A queryable co-change matrix surfaces such pairs systematically, and can later feed the Phase D injection-ranking layer (git-aware boosts).

## Acceptance Criteria

- [ ] `scripts/pg-lab/schema/git-mining.sql`: `repo.commits(sha, ts, author, subject)` + `repo.file_changes(sha, path, additions, deletions)`.
- [ ] `scripts/pg-lab/git-mine.sh --import`: incremental from last imported sha; `--rebuild` re-imports full history (derived projection; rebuild ≈ minutes, acceptable).
- [ ] `scripts/pg-lab/git-mine.sh hotspots [--since 6mo]`: churn (commit count × line churn) ranked, filtered to existing files.
- [ ] `scripts/pg-lab/git-mine.sh coupled <path> [--min-support 5]`: files co-changing with `<path>`, with support count and confidence %, excluding lockfiles/generated files (share the exclusion list with the repo's existing generated-file conventions).
- [ ] Renames followed (`--numstat -M` parsing of `old => new` paths) or explicitly documented as not-followed in v1.
- [ ] Value probe: run `coupled shared/schema.ts` — it must rediscover the known schema↔pick-list coupling; record the output in Updates as the smoke test.
- [ ] Fixture test: import a synthetic repo history (fixture text, not a real git call) and assert both queries.

## Implementation Notes

- Parse `git log --numstat --format=...` in one pass (awk or a small TS script — implementer's call; TS gets type-checking, bash matches the pg-lab convention so far).
- Binary files report `-` for numstat counts — store 0 and a flag.
- Co-change SQL: self-join file_changes on sha with support/confidence aggregation — keep it a VIEW so thresholds are query-time.

## Dependencies

- `P3-2026-07-05-pg-lab-foundation-codify-near-dup.md` MERGED.

## Risks

- Monorepo path moves (2026 route/storage domain splits) fragment identity — rename-following matters more here than in most repos; if v1 skips it, say so loudly in the report output.

## Updates

### 2026-07-05

- Initial creation from PG Lab roadmap (Batch C).
