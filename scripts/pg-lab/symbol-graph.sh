#!/usr/bin/env bash
# scripts/pg-lab/symbol-graph.sh — canned recursive-CTE queries against the TypeScript
# module-import/export graph snapshot in repo.modules/repo.imports/repo.exports (see
# scripts/pg-lab/schema/symbol-graph.sql and scripts/pg-lab/symbol-graph.ts --rebuild,
# which populates it — this script only reads).
#
# Snapshot staleness is expected and always shown: every invocation prints the recorded
# snapshot's git SHA + age from repo.snapshot_meta before running the query ("Nightly-
# manual, not a hook" per the owning todo's Implementation Notes — staleness must be
# visible, never hidden).
#
# Commands:
#   blast <path>    Transitive dependents of <path> -- every module that imports it,
#                   directly or through a chain of imports (recursive CTE walking
#                   repo.imports backwards from to_path to from_path). "What breaks if I
#                   change this file."
#   dead-exports    Exports with ref_count = 0, excluding a small entrypoint/config
#                   allowlist (root RN/Express entrypoints and *.config.* files -- those
#                   are invoked BY tooling, never imported, so a real reference graph
#                   correctly reports them as zero-referenced even though they are very
#                   much alive). NEVER auto-delete from this output -- per the owning
#                   todo's Risks, triage before trusting a hit (dynamic access, string
#                   refs, and the client/server boundary are all real false-positive
#                   sources).
#   cycles          Modules that import themselves through some chain, via Postgres 16+'s
#                   native CYCLE clause (this environment's local Postgres is v18).
#   layering        server/routes/** files that import server/storage/** directly instead
#                   of through the server/storage/index.ts barrel -- a violation of this
#                   repo's server domain-split architecture (routes only ever import
#                   `../storage`, never a storage domain file directly).
#
# Usage:
#   scripts/pg-lab/symbol-graph.sh blast <repo-relative-path>
#   scripts/pg-lab/symbol-graph.sh dead-exports
#   scripts/pg-lab/symbol-graph.sh cycles
#   scripts/pg-lab/symbol-graph.sh layering
set -uo pipefail

LAB_DATABASE_URL="${LAB_DATABASE_URL:-postgresql://localhost/ocrecipes_lab}"

# Hard safety rail, matching init.sh/codify-neardup.sh: this tool must never run against a
# real app database, no matter what LAB_DATABASE_URL is set to.
case "${LAB_DATABASE_URL##*/}" in
  nutricam | ocrecipes_solutions)
    echo "symbol-graph.sh: refusing — LAB_DATABASE_URL resolves to '${LAB_DATABASE_URL##*/}', a real app database, not a PG Lab database" >&2
    exit 1
    ;;
esac

command -v psql >/dev/null 2>&1 || { echo "symbol-graph.sh: psql not found on PATH" >&2; exit 1; }

CMD="${1:-}"
if [ -z "$CMD" ]; then
  echo "Usage: $0 blast <path> | dead-exports | cycles | layering" >&2
  exit 1
fi

print_snapshot_age() {
  psql -X -q -tA -d "$LAB_DATABASE_URL" -c \
    "SELECT 'snapshot: sha ' || coalesce(sha, 'unknown') || ', rebuilt ' || to_char(rebuilt_at, 'YYYY-MM-DD HH24:MI') || ' (' || round(extract(epoch FROM (now() - rebuilt_at)) / 3600.0, 1) || 'h ago)' FROM repo.snapshot_meta" 2>/dev/null
}

case "$CMD" in
  blast)
    TARGET="${2:-}"
    if [ -z "$TARGET" ]; then
      echo "Usage: $0 blast <repo-relative-path>" >&2
      exit 1
    fi
    print_snapshot_age
    # psql -c does NOT interpolate :'var' substitution (docs/solutions/logic-errors/
    # psql-c-flag-skips-var-substitution-2026-07-05.md) -- a parametrized query MUST go
    # through stdin/heredoc, never -c.
    #
    # Deliberately dedups on `path` ALONE, not (path, depth): this repo's real import graph
    # has genuine cycles (see the `cycles` command), and tracking depth in the dedup key
    # means a node reachable through a cycle gets re-emitted at ever-increasing depth
    # forever -- Postgres's recursive UNION only discards a row that exactly duplicates a
    # PRIOR row, and (path, depth+1) never duplicates (path, depth). That is the same class
    # of unbounded-recursion bug the `cycles` query comment documents (verified
    # empirically: an earlier (path, depth) version of this exact query exhausted disk).
    # Path-alone dedup makes this a plain reachability-set fixpoint, safe on any graph
    # including cyclic ones.
    psql -X -q -d "$LAB_DATABASE_URL" -v target="$TARGET" <<'SQL'
WITH RECURSIVE blast (path) AS (
  SELECT from_path
  FROM repo.imports
  WHERE to_path = :'target'
  UNION
  SELECT i.from_path
  FROM repo.imports i
  JOIN blast b ON i.to_path = b.path
)
SELECT path
FROM blast
ORDER BY path;
SQL
    ;;

  dead-exports)
    print_snapshot_age
    psql -X -q -d "$LAB_DATABASE_URL" <<'SQL'
SELECT path, name
FROM repo.exports
WHERE ref_count = 0
  -- Entrypoint/config allowlist: invoked BY tooling (Expo/Metro, Express, Vitest/ESLint/
  -- drizzle-kit/Babel config loaders), never imported by another module, so a correct
  -- reference graph reports these as zero-referenced even though they are load-bearing.
  AND path NOT IN ('client/index.js', 'client/App.tsx', 'server/index.ts')
  AND path NOT LIKE '%.config.ts'
  AND path NOT LIKE '%.config.js'
  -- Drizzle relations() objects (shared/schema.ts's `export const xRelations = relations(
  -- x, ...)` exports): confirmed via the one-time value-probe triage (this todo's Updates
  -- section) to be a systematic false-positive class -- drizzle-orm's query builder is
  -- constructed as `drizzle(pool, { schema })`, passing the WHOLE schema namespace object,
  -- and consumes each xRelations export via runtime property enumeration over that object,
  -- never a static import our graph can see. 26/264 dead-export candidates in the initial
  -- triage were this exact pattern.
  AND NOT (path = 'shared/schema.ts' AND name LIKE '%Relations')
  -- Vitest __mocks__/ convention files: confirmed via the same triage -- `vi.mock("../auth")`
  -- (no factory argument) makes Vitest swap in the sibling `__mocks__/auth.ts` file at
  -- runtime via directory convention, never a static import of that mock file's path, so
  -- its exports are invisible to any static reference graph.
  AND path NOT LIKE '%__mocks__%'
ORDER BY path, name;
SQL
    ;;

  cycles)
    print_snapshot_age
    # Deliberately NOT a path-enumerating recursive CTE with the CYCLE clause: seeding one
    # recursion branch per edge and tracking a full per-branch path array only bounds
    # INFINITE recursion, not the row count -- on this repo's real import graph (~1000
    # modules, ~6000 edges, heavy fan-in on hub files like shared/schema.ts), that shape
    # enumerates every DISTINCT PATH between every reachable pair and exhausts disk before
    # finishing (verified empirically: it ran the local Postgres temp tablespace out of
    # space). Instead, compute the transitive-closure REACHABILITY relation -- pairs of
    # (start_path, reached_path), not full paths -- using plain UNION (not UNION ALL) so
    # Postgres's built-in whole-history duplicate elimination collapses every redundant
    # path into the same row instead of enumerating it separately. That bounds the result
    # at O(modules^2) instead of combinatorial-in-path-count, exactly like the `blast`
    # query above (same technique, opposite direction). A module is "in a cycle" iff it can
    # reach itself.
    psql -X -q -d "$LAB_DATABASE_URL" <<'SQL'
WITH RECURSIVE reach (start_path, path) AS (
  SELECT from_path, to_path
  FROM repo.imports
  UNION
  SELECT r.start_path, i.to_path
  FROM repo.imports i
  JOIN reach r ON i.from_path = r.path
)
SELECT DISTINCT start_path AS module_in_cycle
FROM reach
WHERE path = start_path
ORDER BY start_path;
SQL
    ;;

  layering)
    print_snapshot_age
    psql -X -q -d "$LAB_DATABASE_URL" <<'SQL'
SELECT DISTINCT from_path AS route_file, to_path AS storage_internal_file
FROM repo.imports
WHERE from_path LIKE 'server/routes/%'
  -- Route TESTS legitimately reach into storage internals directly for setup/teardown
  -- (verified empirically: server/routes/__tests__/*.test.ts files are the only current
  -- hits on this pattern) -- that's test-support code, not a production architecture
  -- violation, so exclude it rather than let it drown out a real layering hit.
  AND from_path NOT LIKE '%__tests__%'
  AND from_path NOT LIKE '%.test.ts'
  AND to_path LIKE 'server/storage/%'
  AND to_path <> 'server/storage/index.ts'
ORDER BY from_path, to_path;
SQL
    ;;

  *)
    echo "Usage: $0 blast <path> | dead-exports | cycles | layering" >&2
    exit 1
    ;;
esac
