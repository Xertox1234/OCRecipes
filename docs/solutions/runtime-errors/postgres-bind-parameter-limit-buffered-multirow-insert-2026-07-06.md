---
title: 'Buffer-then-flush writers must chunk multi-row INSERTs, not emit one unbounded statement'
track: bug
category: runtime-errors
module: shared
severity: medium
tags: [postgres, pg, bind-parameters, bulk-insert, pg-lab, fail-silent, scaling]
applies_to: [scripts/pg-lab/**/*.ts, evals/lib/**/*.ts]
symptoms: [A buffer-then-flush writer works fine at small row counts then silently stops persisting anything past a threshold, No error is visible anywhere because the failure is caught by the writer's own fail-silent guard, The failure threshold moves with unrelated growth elsewhere in the codebase (more tests, more eval cases, more cached rows)]
created: '2026-07-06'
---

# Buffer-then-flush writers must chunk multi-row INSERTs, not emit one unbounded statement

## Problem

`scripts/pg-lab/vitest-flake-reporter.ts`'s `persistTestRuns` buffers one row per Vitest
test case for the whole suite run and, at `onTestRunEnd`, built ONE `INSERT ... VALUES
($1,...,$8), ($9,...,$16), ...` statement covering every buffered row — bind-parameter
count grows linearly with the row count (`rows.length * columnsPerRow`). Code review (two
independent reviewers) caught this before it shipped: this repo already has 5000+ Vitest
test cases and grows every release, and PostgreSQL's wire protocol hard-caps bind
parameters at 65535 per statement — at 8 columns/row that's a ceiling of ~8191 rows. Once
the suite crosses that line, the single `client.query(...)` call throws, and because the
whole thing sits inside a "never let this block or fail the caller" `catch` (the correct
design for a fail-silent PG Lab writer — a sibling, in-progress todo/PR establishes this
same fail-silent writer shape for `evals/lib/eval-results-store.ts`; see whichever of the
two merges first for the eventual conventions writeup),
the entire run's ledger data is silently dropped — precisely on the largest, most
test-populous runs, where the flake/timing signal this feature exists to capture matters
most.

## Symptoms

- A buffer-then-flush writer (accumulate N rows across a whole run, one INSERT at the end)
  works fine in dev/testing at small N, then silently stops persisting anything once the
  buffered row count crosses `65535 / columnsPerRow`.
- No error is visible anywhere, because the failure is caught by the same fail-silent
  guard that is supposed to only catch "DB unreachable" / "table missing" — the guard
  can't distinguish "the DB is down" from "this one query was structurally too large."
- The failure threshold moves with unrelated growth (adding more tests, more eval cases,
  more cached API rows) — a change to something else silently breaks this feature months
  or years after it shipped, with nothing in that unrelated change's diff to implicate it.

## Root Cause

PostgreSQL's extended-query wire protocol represents the parameter count as a 16-bit
unsigned integer, so a single statement cannot bind more than 65535 parameters, full stop
— this is a protocol-level ceiling, not a tunable server setting. A writer that scales its
bind-parameter count with an unbounded, caller-controlled row count (here: however many
tests ran) will eventually cross it if given enough time/growth, and nothing about the
query itself signals "getting close to a limit" until it's already over.

## Solution

Chunk the buffered rows into fixed-size batches and issue one INSERT per batch, all within
the same connection (one `connect()`/`end()` for the whole run — chunking the SQL
statements does not mean re-connecting per batch):

```typescript
const ROWS_PER_BATCH = 1000; // 1000 * 8 cols = 8000 params — generous headroom under 65535

for (let start = 0; start < rows.length; start += ROWS_PER_BATCH) {
  const batch = rows.slice(start, start + ROWS_PER_BATCH);
  const values: unknown[] = [];
  const placeholders = batch.map((r, i) => {
    const base = i * COLUMNS_PER_ROW; // reset per batch, not global across all rows
    values.push(/* ...this row's columns... */);
    return `($${base + 1}, ..., $${base + COLUMNS_PER_ROW})`;
  });
  await client.query(
    `INSERT INTO ... VALUES ${placeholders.join(", ")}`,
    values,
  );
}
```

Two details that are easy to get wrong:

1. The placeholder index (`base = i * COLUMNS_PER_ROW`) must reset to 0 at the start of
   each batch (via `batch.map`'s own index `i`), not continue counting from the previous
   batch's row count — a global index would silently break every batch after the first.
2. A mid-loop batch failure is still swallowed by the writer's existing outer `catch` (by
   design), and any batches already inserted before the failing one stay committed — no
   transaction wraps the loop. Partial persistence of a large run is strictly better than
   losing 100% of it to one bad batch, so this is intentional, not an oversight.

An alternative for very large row counts: `INSERT ... SELECT * FROM unnest($1::text[],
$2::integer[], ...)` uses a constant number of parameters (one array per column)
regardless of row count, trading batching complexity for array-typing complexity. Chunking
is simpler and sufficient unless a single run can plausibly produce hundreds of thousands
of rows.

## Prevention

Any writer with an unbounded, caller-controlled buffer size — not just this one; the same
shape applies to any future PG Lab writer that batches an entire run's worth of rows into
one flush (an eval run's case-samples, a transcript importer's messages, an API-cache
backfill) — must chunk its INSERT rather than assume the buffer stays small. Pick a batch
size with generous headroom under 65535 (a few thousand rows at typical column counts),
not a size tuned to "today's largest observed run."

## Related Files

- `scripts/pg-lab/vitest-flake-reporter.ts` — `persistTestRuns`, the writer this was found in
- `scripts/pg-lab/__tests__/vitest-flake-reporter.test.ts` — regression test asserting
  exactly 2 `client.query` calls (not 1) when given `ROWS_PER_BATCH + 1` rows

## See Also

- [Avoid parameter-limit overflow in NOT IN lists](../design-patterns/avoid-parameter-limit-overflow-not-in-lists-2026-05-13.md) — the same underlying ~65k Postgres bind-parameter limit, hit via a different query shape (a `NOT IN` predicate list rather than a multi-row `INSERT`); that case collapses to a single array-typed bind (`<> ALL($1::text[])`) instead of chunking, because a `NOT IN` list is one column of values rather than a fixed multi-column row shape
