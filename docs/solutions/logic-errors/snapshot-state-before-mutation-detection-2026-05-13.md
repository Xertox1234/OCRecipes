---
title: "Read-then-write-then-check loses the pre-mutation snapshot"
track: bug
category: logic-errors
tags: [database, race-condition, mutation-detection, ordering]
module: server
applies_to:
  [
    "server/routes/verification.ts",
    "server/services/reformulation-detection.ts",
  ]
symptoms:
  - "Detection logic never fires because before/after values are identical"
  - "Reformulation flags always come back empty in happy-path tests"
  - "Route handler appears to work but produces zero side effects"
created: 2026-03-25
severity: high
---

# Read-then-write-then-check loses the pre-mutation snapshot

## Problem

The product reformulation detection feature needed to compare a barcode's nutritional data before and after a new verification submission. The original implementation called `submitVerification()` (which mutated the DB row) and then read the verification back to compare with the new data. Because the row was already updated, "before" and "after" were identical and the detection logic never triggered.

## Symptoms

- `detectReformulation(current, data)` always returns `[]` because `current === data`
- No errors or crashes — the route handler runs to completion
- Only a test that asserts a flag **WAS** created reveals the bug

## Root Cause

When a route needs to compare a record's pre-mutation state to the incoming write, the read **must happen before** the write. Reading after the mutation gives the post-mutation state, which equals the input value.

```typescript
// Bad — reads post-mutation state, detection never fires
await submitVerification(barcode, data);
const current = await getVerification(barcode); // already mutated
const flags = detectReformulation(current, data); // current === data → no flags
```

## Solution

Snapshot the pre-mutation state explicitly, with a name that signals intent:

```typescript
// Good — snapshot before mutation
const preSubmitState = await getVerification(barcode); // read BEFORE write
await submitVerification(barcode, data);
const flags = detectReformulation(preSubmitState, data);
```

## Prevention

- Use names like `preSubmitX` or `snapshotX` to make the ordering requirement obvious.
- Distinguish this pattern from optimistic locking — here the goal is to compare old vs. new values within a single request, not to prevent concurrent writes.
- Add a regression test that asserts a flag **was created** (positive assertion). A test that only checks "no error" will not catch this.

## Related Files

- `server/routes/verification.ts` — `preSubmitVerification` snapshot before `submitVerification()` call
- `server/services/reformulation-detection.ts` — pure detection logic that receives the snapshot

## See Also

- [Side effect ordering around db.transaction](../conventions/side-effect-ordering-around-db-transaction-2026-05-13.md)
