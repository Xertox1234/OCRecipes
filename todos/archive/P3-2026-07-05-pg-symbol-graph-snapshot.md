<!-- Filename: P3-2026-07-05-pg-symbol-graph-snapshot.md -->

---

title: "PG Lab: TypeScript symbol/import graph snapshot for aggregate queries"
status: done
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

- [x] `scripts/pg-lab/schema/symbol-graph.sql`: `repo.modules(path)`, `repo.imports(from_path, to_path, names text[])`, `repo.exports(path, name, ref_count)`.
- [x] `scripts/pg-lab/symbol-graph.ts --rebuild`: full re-export using ts-morph or the TypeScript compiler API, resolving `@/` and `@shared/` aliases from tsconfig (MUST match the real alias config, not hardcoded). Snapshot-only — no incremental mode (rebuild is the contract).
- [x] Canned queries (`scripts/pg-lab/symbol-graph.sh <cmd>`): `blast <path>` (transitive dependents, recursive CTE), `dead-exports` (ref_count 0, excluding entrypoints/config allowlist), `cycles`, `layering` (routes→storage direct-import violations per the server domain-split architecture).
- [x] Value probe: `dead-exports` output triaged once — record in Updates how many were real vs false positives; that ratio decides whether the tool stays.
- [x] Test: fixture mini-project (3-4 files with aliases, a cycle, a dead export) → rebuild → assert each canned query.

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

### 2026-07-06

- Implemented: `scripts/pg-lab/schema/symbol-graph.sql` (`repo.modules`/`repo.imports`/
  `repo.exports`/`repo.snapshot_meta`), `scripts/pg-lab/symbol-graph.ts --rebuild` (ts-morph,
  devDependency added), `scripts/pg-lab/symbol-graph.sh` (`blast`/`dead-exports`/`cycles`/
  `layering`), and `.claude/hooks/test-pg-lab-symbol-graph.sh` (fixture mini-project with an
  alias-resolved cycle, a dynamic-import edge, a genuinely dead export, and a namespace-
  import layering violation — all four canned queries asserted).
- **Two correctness bugs found and fixed via live testing against the real repo (1048
  files, 5614 non-type-only import edges after the fix below), not just the fixture**:
  1. `blast`/`cycles`' original recursive CTEs deduped on `(path, depth)`/tracked a full
     per-branch path array. On a real graph with genuine cycles (see below) that never
     converges — Postgres's recursive `UNION` only discards a row that exactly duplicates a
     prior one, and a revisited node at a new depth is never a duplicate, so the query loops
     until the local Postgres temp tablespace ran out of disk (observed directly: a stray
     copy of the query was still running 11 minutes later, disk usage climbing, until killed
     via `pg_terminate_backend`). Fixed by deduping on `path` alone (a plain reachability-set
     fixpoint, bounded at O(modules) per query) — both queries now terminate in well under a
     second on the real repo.
  2. `findReferencesAsNodes()`'s ref-count (the expensive pass-2 escalation for exports with
     zero cheap-pass hits) was implemented as `refs.length - 1`, on the assumption that the
     method always includes the declaration's own name occurrence. Verified empirically
     (a throwaway ts-morph script) that it does **not** — a genuinely unused export returns
     `refs.length === 0`, and one real external usage returns `refs.length === 1`. The `-1`
     floored every pass-2-escalated export with exactly one usage to `ref_count = 0`,
     massively inflating `dead-exports` (264 candidates on the real repo before the fix vs.
     70 immediately after — most of the difference was single-usage exports wrongly zeroed).
     Caught by the fixture test's `getOrderInternal` (used only via a namespace-import
     property access, forcing pass 2) assertion. Fixed by using the raw node count directly.
- **Bonus finding (out of scope to fix here, surfacing for visibility)**: `cycles` correctly
  identified a real 2-file runtime circular import — `server/services/barcode-lookup.ts` and
  `server/services/nutrition-lookup.ts` import each other via named value imports (verified
  by reading both files; the type-only `import type { NutritionData }` half of the same
  import statement was correctly excluded from the graph by the type-only-edge fix below).
- **Precision refinement — type-only imports excluded from the graph entirely**
  (`decl.isTypeOnly()` / `spec.isTypeOnly()` on both `ImportDeclaration`/`ExportDeclaration`):
  `import type {...}` has zero runtime footprint, but was originally recorded as a graph
  edge, inflating `cycles` from 2 real hits to 82 — almost entirely RN navigation
  param-type circularity (a screen's prop types importing back from
  `RootStackNavigator.tsx`), which is completely benign at compile-erased type level.
- **`layering` query refined twice** after running against the real repo: (1) excluded
  `%__tests__%`/`%.test.ts` from `from_path` — the only initial hits were
  `server/routes/__tests__/*.test.ts` files reaching into `server/storage/sessions.ts`
  directly for test setup, not a production architecture violation (confirmed zero real
  violations exist today, matching the wide-deletion-sweep memory's expectation that this
  repo's routes only ever import the `../storage` barrel).
- **Value probe (dead-exports triage, run once against the real repo post-fixes)**: 264
  raw candidates → 62 after two allowlist refinements confirmed via this triage:
  - **Drizzle `relations()` objects** (`shared/schema.ts`'s `export const xRelations = ...`,
    26 of the original 264): `drizzle(pool, { schema })` passes the whole schema namespace
    object and Drizzle consumes each `xRelations` export via runtime property enumeration,
    never a static import — a genuine, systematic false-positive class. Added
    `path = 'shared/schema.ts' AND name LIKE '%Relations'` to the exclusion list.
  - **Vitest `__mocks__/` convention files** (`server/middleware/__mocks__/*.ts`, 8 rows):
    confirmed every hit corresponds to a `vi.mock("../../middleware/auth")` call with no
    factory argument — Vitest swaps in the sibling `__mocks__/auth.ts` file by directory
    convention at runtime, never a static import of that path. Added `path NOT LIKE
'%__mocks__%'` to the exclusion list.
  - **Remaining 62 candidates**: spot-checked 8 across both rounds (`AuthResponse`,
    `CalorieBudgetBar`, `ThemedTextProps`, `UseTTSReturn`, `getEnv`, `throwStatusError`,
    `InsertApiKey`, plus `usersRelations` before the Relations exclusion) via independent
    `grep` across the whole repo — **all 8/8 confirmed genuinely zero-usage**, including one
    interesting real finding (`client/components/CalorieBudgetBar.tsx`'s `CalorieBudgetBar`
    component itself, not just a type, appears completely unwired — possibly one of the
    "redesign orphans" from `project_recurring_regression_mystery` memory).
  - **Ratio: 0 confirmed false positives found in the final 62-row list** (beyond the two
    now-allowlisted systematic classes, which accounted for 34/264 of the original raw
    output). **Decision: the tool stays** — signal-to-noise is high once the two systematic
    classes are allowlisted, and the two correctness bugs above are fixed at the source, not
    papered over by the allowlist.
- **Code review (code-reviewer + server-reviewer, 1 round)**: both reviewers found the
  earlier fixes sound (recursive-CTE dedup, the `findReferencesAsNodes()` no-`-1` fix,
  `blast`'s injection-safe heredoc parametrization) and flagged no unresolved CRITICALs.
  Three real issues fixed inline:
  1. **A third correctness bug** (code-reviewer, WARNING): `getExportedDeclarations()`
     returns a re-exported symbol's declaration under BOTH its origin file AND every
     barrel that re-exports it (`export {...} from`/`export * from` — 33 such lines
     repo-wide, e.g. `server/storage/index.ts`), producing duplicate `repo.exports` rows
     for the same symbol. Fixed by only recording a candidate at the declaration's true
     origin file (`decl.getSourceFile().getFilePath() === fromAbs`). Real-repo effect:
     `repo.exports` dropped from 2319 to 2113 rows (206 duplicates removed); the
     `dead-exports` output happened to stay at 62 rows in this repo's current state (the
     removed duplicates weren't in the ref_count=0 subset), but the fix is still
     load-bearing — a genuinely dead barrel re-export would otherwise show up twice, and a
     used-only-via-barrel symbol's origin-file row was at risk of a false dead-export flag.
  2. Banned `as unknown as {...}` duck-type cast in `findReferencesCount` (code-reviewer,
     WARNING) replaced with ts-morph's own `Node.isReferenceFindable()` type guard —
     verified identical runtime behavior.
  3. Missing `client.release(rollbackErr)` + swallowed-original-error on a failed ROLLBACK
     (server-reviewer, WARNING) — fixed with a `released` flag so a rollback failure passes
     the error to `release()` (pool destroys rather than reuses the connection) without
     losing the original error or double-releasing.
     All fixes verified: `tsc --noEmit` clean, hook test 17/17 assertions pass, real-repo
     `--rebuild` re-run clean.
- **DEFERRED_WARNINGS** (surfaced for the user, not auto-filed as a todo per the
  Deferred-Item-Todos bar in CLAUDE.md — this is a minor/low-severity followup, not a
  defect):
  - code-reviewer: `scripts/pg-lab/symbol-graph.ts`'s substantial pure logic
    (`resolveModuleBase`, `buildAliasRoots`, `resolveToLoadedSourceFile`,
    `collectDynamicEdgeTargets`, the two-pass `extractGraph` dedup) has no Vitest unit
    coverage — only the live-Postgres-gated `.claude/hooks/test-pg-lab-symbol-graph.sh`
    integration test, which is a no-op in the CI job that runs it (no Postgres service
    there). Both real bugs in this session were caught only by manually running `--rebuild`
    against the real repo, not by any test that runs automatically in CI. Precedent exists
    (`scripts/__tests__/worklet-directive-guard.test.ts`, in-memory `ts.Program` fixtures,
    no filesystem/DB dependency) for adding a `scripts/__tests__/symbol-graph.test.ts`
    exercising the pure functions against a synthetic in-memory ts-morph `Project`.
