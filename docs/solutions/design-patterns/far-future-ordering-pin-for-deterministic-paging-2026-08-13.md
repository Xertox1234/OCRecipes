---
title: Pin owned rows to a far-future ordering value to test paging on a query with no ownership filter
track: knowledge
category: design-patterns
tags: [testing, database, concurrency, test-isolation, postgres, pagination]
module: server
applies_to: ["server/**/__tests__/**/*.ts", "server/storage/**/*.ts"]
symptoms: ["a paging test derives expected page sizes from a whole-table count because the query has no ownership filter", "a page-overlap assertion fails (expected true to be false) though limit/offset are correct", "a comment worries about tie-breaks because CURRENT_TIMESTAMP is fixed per transaction"]
created: 2026-08-13
---

# Pin owned rows to a far-future ordering value to test paging on a query with no ownership filter

## Rule

To test `limit`/`offset` on a query that exposes **no ownership filter**, do not
derive expectations from a whole-table count. Instead, write the query's
**ordering column** on the rows the test seeded, using distinct values that sort
strictly ahead of every other row. The owned rows then provably occupy ordering
positions `0..n-1`, so paging over the head of the result is entirely within rows
the test controls.

## Why

A shared table under parallel test workers can gain and lose rows between
statements (see
[before/after delta over a foreign-writable table](../logic-errors/before-after-delta-over-foreign-writable-table-2026-08-13.md)).
Scoping assertions to owned rows is the standard fix — but a listing function like

```ts
return db
  .select()
  .from(reformulationFlags)
  .where(status ? eq(reformulationFlags.status, status) : undefined)
  .orderBy(desc(reformulationFlags.detectedAt))
  .limit(limit)
  .offset(offset);
```

gives the test no `barcode`/`userId` filter to scope with. The ordering column is
the lever it *does* give you: every naturally-created row is stamped at or before
now, so a far-future value is a total-order guarantee, not a probability. This
converts "hopefully nobody interferes" into a structural invariant, which is the
bar to judge such a fix by — not "it passed three times".

It also removes the tie the query has by construction: `CURRENT_TIMESTAMP` is
fixed **per transaction**, so rows seeded in one test all share a timestamp and
`desc(detectedAt)` has no defined order among them. Distinct pinned values make
exact page *contents* assertable, which is strictly stronger than the page-size
and non-overlap assertions such tests usually settle for.

## Examples

```ts
// Mid-year base so subtracting per-row minutes cannot walk back across the
// year boundary (Jan 1 minus a minute is the PREVIOUS year).
const PIN_BASE_MS = Date.UTC(2999, 5, 1);
const myBarcodes = [makeBarcode(), makeBarcode(), makeBarcode()];

for (const [i, b] of myBarcodes.entries()) {
  await seedBarcodeVerification(b);
  await flagReformulation(b, 5, makeConsensus(), "verified", 3);

  const pinned = await tx
    .update(reformulationFlags)
    .set({ detectedAt: new Date(PIN_BASE_MS - i * 60_000) }) // descending by index
    .where(eq(reformulationFlags.barcode, b))
    .returning({
      id: reformulationFlags.id,
      detectedAt: reformulationFlags.detectedAt,
    });

  // The ordering guarantee rests ENTIRELY on the stored value, so assert the
  // write landed AND survived the timestamptz round-trip.
  expect(pinned).toHaveLength(1);
  expect(pinned[0].detectedAt.getUTCFullYear()).toBe(2999);
}

// Exact page contents — positions 0,1,2 are ours whatever else is in the table.
expect((await getReformulationFlags(undefined, 2, 0)).map((r) => r.barcode)) //
  .toEqual([myBarcodes[0], myBarcodes[1]]);

// A window wholly inside owned rows: the strongest offset proof available,
// because it cannot be satisfied by re-slicing page one.
expect((await getReformulationFlags(undefined, 2, 1)).map((r) => r.barcode)) //
  .toEqual([myBarcodes[1], myBarcodes[2]]);

// Offset past the owned head. Length is deliberately NOT asserted — it is 1
// when this file runs alone and 2 when a foreign row trails ours.
const tail = await getReformulationFlags(undefined, 2, 2);
expect(tail.length).toBeGreaterThanOrEqual(1);
expect(tail[0].barcode).toBe(myBarcodes[2]);
```

Three details carry the pattern:

1. **Assert the round-trip, not just the row count.** `expect(pinned).toHaveLength(1)`
   proves a row matched; it does not prove the stored value is what you think. A
   pin that was silently coerced would leave every downstream assertion passing for
   the wrong reason.
2. **Never assert an exact length on a page that extends past the owned rows.**
   That length depends on the foreign population — the one thing the pattern
   exists to eliminate — and it differs between running the file alone and running
   the full suite.
3. **Keep the real write path.** Seed through the production function
   (`flagReformulation`) and pin afterwards, rather than inserting rows directly
   with a chosen timestamp — otherwise the test stops exercising the code it is
   about.

## Exceptions

- **The query already offers an ownership filter** — filter by it; no pin needed.
- **The ordering column is the thing under test** (e.g. asserting `detectedAt`
  defaults to now) — pinning would overwrite the value the test exists to check.
- **The rows are committed rather than rolled back.** This pattern assumes the
  savepoint harness (`test/db-test-utils`), so far-future rows never outlive the
  test. In a file that COMMITs, a leaked sentinel row would head the ordering for
  every later run — clean up explicitly or don't pin.
- **Aggregates.** A `count(*)` has no ordering to pin; use a lower bound over
  owned rows instead (see the linked logic-errors doc).

## Related Files

- `server/storage/__tests__/reformulation.test.ts` — `respects offset parameter`
- `server/storage/reformulation.ts` — `getReformulationFlags`, the unfiltered
  ordered query
- `docs/rules/database.md` — "for tests that need distinct ordering within one
  transaction, pass explicit `new Date(baseTime - N)` values"

## See Also

- [before/after delta over a foreign-writable table](../logic-errors/before-after-delta-over-foreign-writable-table-2026-08-13.md) — the defect this pattern resolves
- [a silence assertion must pin its enabling harness default](../code-quality/silence-assertion-must-pin-its-enabling-harness-default-2026-08-09.md) — same shape: an assertion is only as strong as the precondition it leaves unstated
