---
title: An idempotent schema file with no mechanical application path turns fail-silent writers into total silent row loss
track: bug
category: logic-errors
module: shared
severity: high
tags: [postgres, pg-lab, schema-migration, fail-silent, alter-table, set-default, telemetry, self-apply]
applies_to: [scripts/pg-lab/**, .claude/hooks/**]
symptoms: [A telemetry/analytics table records zero rows for days with no error anywhere — the report just shows an implausible dead zone, An INSERT naming a newly added column errors "column does not exist" but the writer's ">/dev/null 2>&1 … || true" swallows it, The schema .sql file contains the correct idempotent ALTER — but the standing database never ran it]
created: '2026-07-20'
---

# An idempotent schema file with no mechanical application path turns fail-silent writers into total silent row loss

## Problem

PR #673 added `agent_id` to `harness.injection_log` via a textbook idempotent
`ALTER TABLE … ADD COLUMN IF NOT EXISTS` in `scripts/pg-lab/schema/injection-log.sql`,
and updated `scripts/pg-lab/log-injection.sh`'s INSERT to name the new column. But
nothing in the repo applies `schema/*.sql` mechanically: `init.sh` creates only the
DB/extension/schemas, there is no migration runner, and the only appliers were
throwaway-DB test harnesses. Post-merge, every INSERT from both producers would have
named a nonexistent column on the standing `ocrecipes_lab` DB, failed, and been
swallowed by the fail-silent design — **100% of telemetry rows silently dropped** until
a human hand-applied the file. Verified empirically pre-merge: old-schema DB + new
consumer → exit 0, zero rows landed.

## Symptoms

- `injection-report.sh` (or any ledger report) shows an implausible gap starting at a
  merge date; no error was ever printed anywhere.
- The PR's own verification passed — against a **throwaway** DB that applied the new
  schema file. Throwaway-DB verification structurally cannot catch bootstrap gaps on
  the standing DB.
- The loss is total, not partial: the INSERT statement names the new column
  unconditionally, so old-schema DBs reject every row, not just the new field.

## Root Cause

"Idempotent and safe to re-run" answers *how* the schema file applies, not *when* or
*by-what*. With fail-silent writers (PG Lab ground rules: hooks must never fail the
edit path), the writers can neither apply the schema nor report drift — so if no loud
path applies it, schema drift is undetectable by design. The repo's actual convention
was one level up: five pg-lab report scripts (`eval-report.sh`, `flake-report.sh`,
`codify-neardup.sh`, `transcripts.sh`, `git-mine.sh`) self-apply their schema file
idempotently on startup; `injection-report.sh` was the one sibling that didn't.

## Solution

Two halves — the application path, and the column-add shape:

1. **Application path**: the loud, human-run entry point self-applies its schema before
   querying (`injection-report.sh` now does):

   ```bash
   PGOPTIONS='-c client_min_messages=warning' \
     psql -X -q -v ON_ERROR_STOP=1 -d "$LAB_DATABASE_URL" -f "$SCRIPT_DIR/schema/injection-log.sql" >/dev/null
   ```

   Plus a one-time apply at merge for the standing DB — the report-side self-apply
   alone heals lazily, and rows written between merge and the first report run are
   still lost.

2. **Column-add shape** (all three matter):
   - Declare in the **ALTER only**, never restated in `CREATE TABLE`
     (`eval-results.sql` `output_hash` convention) — two declaration sites drift
     silently because `ADD COLUMN IF NOT EXISTS` no-ops regardless of definition.
   - `ALTER COLUMN … SET DEFAULT ''` as its **own statement** — an inline DEFAULT on
     the `ADD COLUMN IF NOT EXISTS` line no-ops for every DB where the column already
     exists. The default also normalizes short INSERTs from stale pre-merge checkouts
     (executor worktrees run their own copy of the consumer) server-side.
   - An **idempotent backfill** (`UPDATE … SET col = '' WHERE col IS NULL`) so "absent"
     has one canonical encoding — `ADD COLUMN` backfills existing rows with NULL while
     new writes insert `''`, silently splitting the population for any future
     `GROUP BY` / `WHERE col = ''` / `IS NULL` analytics.

## Prevention

- A schema PR must answer, in the diff or PR body: *what mechanically applies this to
  every standing DB, and when?* "The file is idempotent" is not an answer —
  idempotent-but-never-applied is unapplied.
- Verify writes against a DB carrying the **old** schema (expect graceful behavior or
  a loud failure — never silent loss), not only against a fresh throwaway that ran the
  new file.
- Review rule codified in `.claude/agents/server-reviewer.md` → Schema Changes.

## Related Files

- `scripts/pg-lab/injection-report.sh` — the self-apply block (mirrors its 5 siblings)
- `scripts/pg-lab/schema/injection-log.sql` — ALTER-only + SET DEFAULT + backfill shape
- `scripts/pg-lab/log-injection.sh` — the fail-silent writer that can never report drift

## See Also

- [PG Lab TypeScript writer: fail-silent event-ledger insert pattern](../conventions/pg-lab-fail-silent-typescript-writer-pattern-2026-07-06.md) — the writer-side contract that makes the application path load-bearing
- [Migrate prod schema before merging column-adds](../best-practices/migrate-prod-schema-before-merge-railway-autodeploy-2026-06-18.md) — the same apply-before-merge ordering for the production app DB
