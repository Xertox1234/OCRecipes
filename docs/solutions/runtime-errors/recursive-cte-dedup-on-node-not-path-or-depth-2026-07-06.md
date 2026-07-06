---
title: 'A recursive CTE that dedups on (node, depth) or a full path array never converges on a real cyclic graph'
track: bug
category: runtime-errors
module: scripts
severity: high
tags: [postgres, sql, recursive-cte, graph, cycles, disk-exhaustion, pg-lab]
symptoms: ['A recursive CTE walking a real-world dependency/import graph runs for many minutes without completing', 'Postgres errors with `could not write to file "base/pgsql_tmp/..."` / `No space left on device`', '`pg_stat_activity` shows the same query still `active` many minutes after it was issued, with no sign of finishing']
applies_to: [scripts/pg-lab/**/*.sql, scripts/pg-lab/**/*.sh]
created: '2026-07-06'
---

# A recursive CTE that dedups on (node, depth) or a full path array never converges on a real cyclic graph

## Problem

A "transitive dependents" (blast-radius) recursive CTE and a "does this node reach itself"
(cycle-detection) recursive CTE were both built by walking a `repo.imports(from_path,
to_path)` edge table with `WITH RECURSIVE ... UNION ...`, using `(path, depth)` as the
tracked/deduped tuple for blast radius, and a full per-branch path array (via Postgres's
`CYCLE ... SET ... USING ...` clause) for cycle detection. Both were tested successfully
against a small hand-built fixture (3-4 files, one deliberate cycle) and passed. Run against
the real repo's import graph (~1000 files, ~6000 edges, several real cycles and heavy
fan-in on hub files like a shared schema module), the cycle-detection query never returned:
`pg_stat_activity` showed it still `active` 11 minutes later, and the query eventually
errored with a disk-full error from Postgres's temp tablespace.

## Symptoms

- A recursive CTE walking a real-world dependency/import graph runs for many minutes
  without completing, where the same shape of query finished instantly on a small
  hand-built test fixture.
- Postgres errors with `could not write to file "base/pgsql_tmp/pgsql_tmp<N>.<M>": No
  space left on device` (or the query is simply still `active` in `pg_stat_activity` far
  longer than expected).
- The query "worked in testing" — the bug is invisible until the graph has both real
  fan-in (multiple paths reach the same node, e.g. everything importing a shared schema
  file) and a real cycle, neither of which a small synthetic fixture typically has by
  accident.

## Root Cause

Postgres's recursive `UNION` (not `UNION ALL`) deduplicates a candidate row against the
**entire accumulated result set so far**, but only when the row is an EXACT duplicate of a
previously-produced row. Two subtly different designs both defeat this:

1. **`(node, depth)` as the tracked tuple.** If the graph has a cycle reachable from the
   starting point, a node inside that cycle gets revisited at ever-increasing depth on each
   loop around the cycle. `(nodeA, 3)` and `(nodeA, 7)` are never the same row, so the
   dedup never fires for that node, and the recursion runs until Postgres runs out of
   resources (in this case: temp disk space for the intermediate working table).
2. **A full per-branch path array**, seeded once per STARTING EDGE (not once per starting
   node) and tracked via the `CYCLE ... SET is_cycle USING visited` clause. `CYCLE` correctly
   prevents any single branch from looping forever, but it does nothing about the
   combinatorial blow-up across branches: for every one of the ~6000 starting edges, the
   query independently enumerates every DISTINCT PATH from that edge's endpoint outward,
   and a real-world graph's ordinary diamond-shaped dependencies (A imports B and C, both B
   and C import D) multiply the number of distinct paths at every fan-in point. This is
   exponential in path length, not proportional to the number of nodes or edges, and blows
   up long before any individual branch's cycle is detected.

Both designs answer a strictly harder question ("give me every distinct path") than the one
actually needed ("which nodes are reachable from X" / "which nodes can reach themselves").

## Solution

Track (and dedup on) a **reachability pair**, not a path: `(start_node, current_node)` for
an all-pairs question like cycle detection, or `current_node` alone for a single-source
question like blast radius. This makes the recursive CTE a plain BFS/fixpoint over
reachability, which plain `UNION`'s whole-history dedup handles correctly and cheaply —
bounded at O(nodes) for a single-source walk, or O(nodes²) worst case for an all-pairs
walk, instead of combinatorial-in-path-count:

```sql
-- Single-source reachability (blast radius): dedup on the node alone.
WITH RECURSIVE blast (path) AS (
  SELECT from_path FROM repo.imports WHERE to_path = 'target/file.ts'
  UNION
  SELECT i.from_path FROM repo.imports i JOIN blast b ON i.to_path = b.path
)
SELECT path FROM blast ORDER BY path;

-- All-pairs reachability (cycle detection): dedup on the (start, current) pair, then
-- select rows where a node reaches itself.
WITH RECURSIVE reach (start_path, path) AS (
  SELECT from_path, to_path FROM repo.imports
  UNION
  SELECT r.start_path, i.to_path FROM repo.imports i JOIN reach r ON i.from_path = r.path
)
SELECT DISTINCT start_path AS module_in_cycle FROM reach WHERE path = start_path;
```

Both queries complete in well under a second against the real ~1000-node/~6000-edge graph
that made the `(node, depth)` / `CYCLE`-with-per-edge-seeding versions never finish.

## Prevention

- If a recursive CTE's SELECT list includes anything beyond the node identity itself (a
  depth counter, a running path array, an accumulated cost), first ask whether the actual
  question needs that value, or only needs "is this node reachable." If it's the latter,
  drop the extra column(s) from the tracked tuple so plain `UNION` can dedup on node
  identity alone.
- Never trust a recursive-CTE test fixture that is hand-built small and mostly acyclic to
  validate performance/termination — it will not exhibit the combinatorial fan-in blow-up
  or the depth-tracking non-convergence that only appear on a graph with real cycles AND
  real fan-in. Test the actual production-scale graph (or a synthetic graph deliberately
  constructed with both properties) before trusting a recursive CTE's shape.
- When developing a new recursive CTE interactively, run it with `PGOPTIONS='-c
  statement_timeout=<N>ms'` (or `SET statement_timeout` in the session) so a wrong design
  aborts loudly and fast instead of silently consuming disk for many minutes. If a
  long-running query IS found stuck, `SELECT pid, query, now()-query_start FROM
  pg_stat_activity` to identify it and `SELECT pg_terminate_backend(<pid>)` to kill it —
  do not just wait, since it may also be holding a lock that blocks unrelated later
  queries (e.g. a stuck read blocking a later `TRUNCATE` on the same table).

## Related Files

- `scripts/pg-lab/symbol-graph.sh` — the `blast` and `cycles` canned queries, both fixed to
  the reachability-pair shape above

## See Also

- [A glob-driven runner loop passes green when the glob matches nothing](../logic-errors/glob-runner-loop-fails-open-count-and-fail-on-zero-2026-07-03.md) — another case where a query/loop design that looks correct on a small case silently fails at real scale
