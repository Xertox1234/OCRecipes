---
title: 'PG Lab TypeScript writer: fail-silent event-ledger insert pattern (pg Client)'
track: knowledge
category: conventions
module: shared
tags: [postgres, pg, fail-silent, pg-lab, testing, event-ledger]
applies_to: [evals/lib/**, scripts/pg-lab/**]
created: '2026-07-06'
---

# PG Lab TypeScript writer: fail-silent event-ledger insert pattern (pg Client)

## Rule

Every TypeScript consumer of the local `ocrecipes_lab` PG Lab database that writes from an
automatic, unattended hot path (an eval runner, a Vitest reporter, an API-cache wrapper —
not a human-invoked CLI script) must implement this shape, established by
`evals/lib/eval-results-store.ts`'s `persistResults()`:

1. Construct a one-shot `pg.Client` (not a shared `Pool` — these are once-per-run writes)
   with **both** `connectionTimeoutMillis` (bounds the connect phase, ~250ms) **and**
   `query_timeout` (bounds the query itself, ~2000ms). A connect timeout alone does not
   protect against a query that hangs after a successful connect (lock contention, a
   stalled network after connect).
2. Before connecting, check the resolved database name against the same
   nutricam/ocrecipes_solutions denylist every PG Lab script uses
   (`scripts/pg-lab/init.sh`, `codify-neardup.sh`), parsed via
   `new URL(connectionString).pathname` — **not** a raw `connectionString.split("/").pop()`,
   which a trailing query string (`?sslmode=require`) can smuggle past. Unlike the
   human-invoked shell scripts (which fail LOUD on a denylist hit), an automatic/unattended
   writer treats it as **another silent no-op** — never throw.
3. Wrap `connect()` and the `query()` in their own `try/catch` so a connect failure AND a
   missing-table/schema-drift query error are both swallowed; run `client.end()` in a
   `finally` (itself wrapped so an `end()` rejection can't escape either) regardless of
   whether the query succeeded.
4. Return `void` with no signal a caller could branch on — this makes it structurally
   impossible for calling code to accidentally couple its own success to persistence
   succeeding.
5. If the writer needs the current commit for provenance, mark it `-dirty` when there are
   uncommitted changes using `git status --porcelain` (**not** `git diff --quiet && git
   diff --cached --quiet`, which only sees changes to already-tracked paths and misses a
   brand-new untracked file) — otherwise an iterative pre-commit workflow blends two
   different code versions under one commit key.
6. A schema file evolved after its first version (a column added later) needs an
   idempotent `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` alongside the original
   `CREATE TABLE IF NOT EXISTS` — the latter is a no-op against an already-existing table
   and will never add the new column, and step 3's fail-silent `catch` then permanently
   and invisibly swallows the resulting "column does not exist" error on every future
   write for anyone who bootstrapped the table from an earlier version of the file.

## Why

This project has 8 PG Lab items across 4 execution batches
(`docs/research/2026-07-05-pg-lab-roadmap.md`), most adding their own TypeScript writer
into a hot path (an eval runner, a Vitest flake-ledger reporter, an external-API-cache
wrapper). The PG Lab design rail is "Postgres down or ocrecipes_lab missing -> no-op
instantly" — every point above was a real gap two code-review rounds caught in the FIRST
TypeScript writer built to this pattern. A future writer that copies only the
connect/try-catch/end "surface shape" without these specific hardening details will
reproduce the same review findings.

## Examples

See `evals/lib/eval-results-store.ts`'s `persistResults()` for the reference
implementation, and `evals/__tests__/eval-results-store.test.ts` for the accompanying test
shape — mock `pg`'s `Client` **and** `child_process`'s `execSync` if the writer computes a
commit hash (mock both, or the dirty-tree branch executes real `git` against the ambient
repo and the test has zero regression coverage for it). See
[vitest4-mock-new-needs-real-class-not-arrow-vifn](../runtime-errors/vitest4-mock-new-needs-real-class-not-arrow-vifn-2026-06-19.md)
for why the `Client` mock specifically must be a `function`, not an arrow function.

## Exceptions

The nutricam/ocrecipes_solutions denylist and the connect/query timeouts apply to every
PG Lab writer, no exceptions. The commit `-dirty` marker and any sample-suffix stripping
are specific to writers that persist per-run provenance or repeated-sample data — skip
them if the writer's rows have no such concept (e.g. a flat API-cache entry keyed by
request hash has no "commit" or "sample" dimension).

## Related Files

- `evals/lib/eval-results-store.ts`
- `evals/__tests__/eval-results-store.test.ts`
- `scripts/pg-lab/init.sh`
- `scripts/pg-lab/codify-neardup.sh`

## See Also

- [psql -c does not interpolate :'var' substitution](../logic-errors/psql-c-flag-skips-var-substitution-2026-07-05.md) — the shell-script-side counterpart gotcha for PG Lab scripts
