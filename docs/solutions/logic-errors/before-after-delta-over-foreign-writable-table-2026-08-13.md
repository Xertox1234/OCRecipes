---
title: A before/after delta is unstable in BOTH directions when a sibling test file commits to the same table
track: bug
category: logic-errors
tags: [testing, database, concurrency, test-isolation, postgres, vitest]
module: server
applies_to: ["server/**/__tests__/**/*.ts", "server/storage/**/*.ts"]
symptoms: ["a storage test asserting a before/after row-count delta fails with a NEGATIVE or inflated number (expected -5 to be 3, expected 4 to be 3)", "passes 16/16 when the file runs alone, reds only in the full suite", "all retry attempts fail, each with a DIFFERENT wrong number", "a nearby comment claims the delta is parallel-worker safe"]
created: 2026-08-13
severity: medium
---

# A before/after delta is unstable in BOTH directions when a sibling test file commits to the same table

## Problem

A test brackets its own seeding with two whole-table reads and asserts the
difference:

```ts
const before = await getReformulationFlagCount();
// ... seed 3 rows ...
const after = await getReformulationFlagCount();
expect(after - before).toBe(3); // ❌ unstable
```

The intent — "absorb other workers' rows by measuring a delta instead of an
absolute" — is only sound if the foreign population is **constant across the
window**. It is not, whenever another test file writes **committed** rows to the
same table.

## Symptoms

- `expected -5 to be 3` / `expected -3 to be 1` — the foreign population
  **shrank** mid-window (a sibling's cleanup ran).
- `expected 4 to be 3` — the foreign population **grew** mid-window.
- Passes 16/16 alone, reds the full suite.
- Survives `retry`, with a different wrong number each attempt.

## Root Cause

Two independent facts compose:

1. **A sibling test file commits real rows.** Most DB tests here run inside
   `test/db-test-utils`' savepoint harness, so their writes are invisible to
   everyone and rolled back. But a file that must exercise genuine multi-connection
   concurrency (`server/storage/__tests__/verification.concurrent.test.ts`)
   deliberately opts **out** of that harness — it needs distinct pool connections
   for a real lock race. It therefore COMMITs its rows and bulk-deletes them in
   `afterAll`. Those rows are visible to every other worker, and then vanish.

2. **READ COMMITTED re-snapshots per statement.** Being inside a transaction does
   not freeze your view. Each statement sees the latest *committed* data, so two
   reads in the same test can disagree — in either direction.

The delta therefore measures `ourInserts + (foreign_t1 - foreign_t0)`, and the
second term is unbounded and unsigned.

**Why `retry` cannot help.** Retries re-run inside the same suite window, while
the sibling that causes the churn is still active. A higher retry count converts a
reproducible isolation bug into a slower reproducible isolation bug.

**The failure is not limited to counts.** Any two statements can disagree, so a
paging test that queries page 1 and page 2 separately can see a row shift between
them and return the same row twice — an overlap assertion fails with
`expected true to be false` even though `limit`/`offset` are correct.

## Solution

Assert only over rows the test **owns**, or over a bound foreign churn cannot
cross.

- **Listing/paging queries** — scope by the barcodes/ids the test seeded. When the
  query offers no ownership filter, make owned rows deterministically occupy the
  head of the ordering: see
  [far-future ordering pin](../design-patterns/far-future-ordering-pin-for-deterministic-paging-2026-08-13.md).

- **Unscoped aggregates (`count(*)`) — first establish WHICH partition the foreign
  writer touches.** This is the step that is easy to skip, and skipping it is
  itself the bug. The committer here only ever calls `flagReformulation`, never
  `resolveReformulationFlag`, and deletes by barcode — so it churns `flagged`
  rows and never `resolved` ones.

  For the **untouched partition**, the population is stable and an **exact delta
  is deterministic**. Use one, with a **negative control** in the other partition
  — without it the delta cannot tell a working filter from a dropped one, since
  your own inserts move a filtered and an unfiltered count by the same amount:

  ```ts
  const before = await getReformulationFlagCount("resolved");
  // ... seed 2 owned rows and resolve them ...
  // Negative control: one owned row left FLAGGED. A dropped `conditions` now
  // moves the count by 3, an inverted one by 1.
  await flagReformulation(control, 5, makeConsensus(), "verified", 3);
  const after = await getReformulationFlagCount("resolved");
  expect(after - before).toBe(2); // ✅ stable AND mutation-killing
  ```

  For the **churned partition**, a deterministic two-read delta genuinely does
  not exist (scoped subtraction, a three-read sandwich, an in-transaction delete
  of the foreign rows, and `REPEATABLE READ` — unsettable after the transaction's
  first statement — all fail). There a **lower bound** over owned rows is the
  surviving property, because foreign churn can only push the count UP:

  ```ts
  const myBarcodes = [makeBarcode(), makeBarcode()];
  for (const b of myBarcodes) {
    await seedBarcodeVerification(b);
    await flagReformulation(b, 5, makeConsensus(), "verified", 3);
  }
  const count = await getReformulationFlagCount("flagged");
  expect(count).toBeGreaterThanOrEqual(myBarcodes.length); // ✅ never falsifiable
  ```

  **A lower bound is weaker than it looks — pair it with a scoped assertion.**
  The property that makes it unfalsifiable (foreign churn only pushes the count
  UP) is the same property that lets foreign rows **satisfy** it outright: with
  ~46 committed rows in the window, `expect(count).toBeGreaterThanOrEqual(2)`
  passes even if the seeding silently did nothing. Seeding two rows instead of
  one does **not** rescue it. Recover owned-row existence with a genuinely
  scoped assertion beside the bound:

  ```ts
  // Barcode-scoped, so no foreign row can satisfy it on our behalf.
  for (const b of myBarcodes) {
    expect(await getReformulationFlag(b)).not.toBeNull();
  }
  const count = await getReformulationFlagCount("flagged");
  expect(count).toBeGreaterThanOrEqual(myBarcodes.length);
  ```

  **Do not conclude from the churned partition that the filter is unassertable
  everywhere.** That over-generalisation is the same modelling error as the
  "workers only ADD rows" claim this doc exists to correct — one partition's
  behaviour was projected onto all of them. The exact-delta-plus-negative-control
  above lives in the untouched partition and kills both the dropped and the
  inverted mutant. Only record a residual for what genuinely remains (here: a
  change to the ternary's ELSE arm alone, detectable only when the file runs in
  isolation). And never close the gap by pointing at a sibling listing test that
  "builds the identical condition expression" — identical *text* in two
  functions is two independent code paths, so exercising one says nothing about
  the other.

## Prevention

- **Reproduce by forcing the interleaving, not by repetition.** Run the hazard
  pairing directly, in a loop:

  ```bash
  npx vitest run server/storage/__tests__/reformulation.test.ts \
                 server/storage/__tests__/verification.concurrent.test.ts
  ```

  This red on the first run where a full-suite run reds perhaps 1 in 20. "It
  passed three times" is the weak check — judge the fix by whether the assertion
  is *structurally* independent of foreign rows.

- **Find the committers before trusting any shared-table assertion.** Every writer
  of the table that skips the savepoint harness is a hazard:

  ```bash
  grep -rln "<writeFn>" --include="*.ts" server/ | \
    while read f; do echo "$f harness=$(grep -c db-test-utils "$f")"; done
  ```

- **Distrust a "parallel-worker safe" comment that only reasons about inserts.**
  The original comment here modelled concurrent workers as monotonically adding
  rows; a second comment in the same file asserted only the *unfiltered* count was
  exposed. Both were wrong — the concurrent writer's rows were `flagged`, so the
  filtered delta had identical exposure. When correcting such a comment, say which
  earlier claim was falsified, or the next reader re-derives the same model.

## Related Files

- `server/storage/__tests__/reformulation.test.ts` — the repaired assertions
- `server/storage/__tests__/verification.concurrent.test.ts` — the committer; its
  header documents why it must skip the harness
- `test/db-test-utils.ts` — the savepoint isolation harness the rest of the DB
  tests rely on

## See Also

- [truthiness guard deletion drops unanalyzed falsy cases](truthiness-guard-deletion-drops-unanalyzed-falsy-cases-2026-07-30.md) — another "the model was narrower than reality" defect
- [far-future ordering pin](../design-patterns/far-future-ordering-pin-for-deterministic-paging-2026-08-13.md) — the ownership-scoping technique for ordered queries
- [a verification that scans zero inputs is green and meaningless](../code-quality/verification-that-scans-zero-inputs-is-green-and-meaningless-2026-08-07.md) — assert the count, not just the exit code
- [a gate over two derivations of the same function is blind](../conventions/gate-over-two-derivations-of-same-function-is-blind-2026-06-14.md) — why "the sibling test builds the identical expression" is not coverage
