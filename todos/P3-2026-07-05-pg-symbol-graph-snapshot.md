<!-- Filename: P3-2026-07-05-pg-symbol-graph-snapshot.md -->

---

title: "PG Lab: TypeScript symbol/import graph snapshot for aggregate queries"
status: backlog
priority: low
created: 2026-07-05
updated: 2026-07-05
assignee:
labels: [deferred, harness]
github_issue:

---

# PG Lab: TypeScript symbol/import graph snapshot for aggregate queries

## Summary

Export the TypeScript module-import graph (and per-export reference counts) into `repo.modules` / `repo.imports` / `repo.exports`, enabling recursive-CTE queries the LSP tool can't express: transitive blast radius, dead exports, dependency cycles, and layering violations (e.g. `routes/` importing `storage/` internals directly).

## Background

Master plan: `docs/research/2026-07-05-pg-lab-roadmap.md`. LSP is a point-query tool (one symbol at a time); aggregate questions ("what transitively depends on nutrition-lookup.ts", "which exports have zero references") need a graph in SQL. The wide-deletion-sweep memory records that orphan greps repeatedly miss locations — dead-export sweeps from a real reference graph are the systematic fix.

## Acceptance Criteria

- [ ] `scripts/pg-lab/schema/symbol-graph.sql`: `repo.modules(path)`, `repo.imports(from_path, to_path, names text[])`, `repo.exports(path, name, ref_count)`.
- [ ] `scripts/pg-lab/symbol-graph.ts --rebuild`: full re-export using ts-morph or the TypeScript compiler API, resolving `@/` and `@shared/` aliases from tsconfig (MUST match the real alias config, not hardcoded). Snapshot-only — no incremental mode (rebuild is the contract).
- [ ] Canned queries (`scripts/pg-lab/symbol-graph.sh <cmd>`): `blast <path>` (transitive dependents, recursive CTE), `dead-exports` (ref_count 0, excluding entrypoints/config allowlist), `cycles`, `layering` (routes→storage direct-import violations per the server domain-split architecture).
- [ ] Value probe: `dead-exports` output triaged once — record in Updates how many were real vs false positives; that ratio decides whether the tool stays.
- [ ] Test: fixture mini-project (3-4 files with aliases, a cycle, a dead export) → rebuild → assert each canned query.

## Implementation Notes

- ts-morph over raw compiler API for velocity; devDependency only.
- ref_count via `languageService.findReferences` is expensive across 40+ table schema files — consider import-name granularity first (cheap) and per-symbol references only for `dead-exports` candidates.
- Dynamic imports and jest/vitest mocks (`vi.mock('@/...')`) are edges too — capture string-literal module refs or false-positive dead code will result.
- Nightly-manual, not a hook: run `--rebuild` on demand; snapshot staleness is fine and stated in output (snapshot sha + age).

## Dependencies

- `P3-2026-07-05-pg-lab-foundation-codify-near-dup.md` MERGED.

## Risks

- False-positive dead exports (dynamic access, string refs, client/server boundary) — allowlist + triage-before-trust; never auto-delete from this tool's output.
- ts-morph full-project load time on the monorepo — measure; if slow, scope to server/+shared/+client/ with skipLibCheck.

## Updates

### 2026-07-05

- Initial creation from PG Lab roadmap (Batch C).
