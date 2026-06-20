---
title: Avoid Re-Querying After Insert — Build History In-Memory
track: bug
category: performance-issues
module: server
severity: medium
tags: [database, returning-clause, redundant-query, verification, performance]
symptoms:
  [
    "Route reads, writes, then reads again — only difference is the row just inserted",
    Double the DB round-trips for every write that needs an updated list,
    Insert returns the new row but the code re-queries instead of using it,
  ]
applies_to: [server/routes/verification.ts, server/storage/**/*.ts]
created: "2026-03-29"
---

# Avoid Re-Querying After Insert — Build History In-Memory

## Problem

The verification submit route needed the full verification history (including the just-inserted row) to detect reformulations. The original code called `getVerificationHistory()` twice — once before the insert (for pre-checks) and once after (to include the new row). The second query is redundant: the only difference is the row that was just inserted, which the route already has in memory.

## Symptoms

- Every verification submission doubles the DB query count
- DB load grows linearly with submission rate
- Code is clear but wasteful — the second query result is obviously derivable

## Root Cause

The "read, write, read" pattern is reflexive: developers reach for a fresh query whenever they need an updated view. In reality, an insert's `RETURNING` clause gives the new row for free, and the rest of the list is already in hand. The second query repeats work the database has already done.

## Solution

Construct the full history in-memory by prepending the newly inserted row to the first query's result:

```typescript
// Before — two DB queries
const historyBefore = await storage.getVerificationHistory(barcode);
await storage.insertVerification(newEntry);
const historyAfter = await storage.getVerificationHistory(barcode); // redundant

// After — one DB query + in-memory construction
const historyBefore = await storage.getVerificationHistory(barcode);
const inserted = await storage.insertVerification(newEntry);
const fullHistory = [inserted, ...historyBefore];
```

## Prevention

- When you need "all rows including the one I just inserted," build the result in-memory from the pre-insert query + the returned insert row.
- This pattern applies any time a route reads, writes, then reads again with the only difference being the written row.
- Use the insert's `RETURNING` clause everywhere — the new row is free.
- Watch for the read-write-read shape during code review; it is a smell for a redundant query.

## Related Files

- `server/routes/verification.ts` — submit handler
- Audit: 2026-03-29-full M10

## See Also

- [Pre-fetched ids avoid redundant queries](../design-patterns/pre-fetched-ids-avoid-redundant-queries-2026-05-13.md)
- [RETURNING to detect missing resources on update](../conventions/returning-to-detect-missing-resources-on-update-2026-05-13.md)
