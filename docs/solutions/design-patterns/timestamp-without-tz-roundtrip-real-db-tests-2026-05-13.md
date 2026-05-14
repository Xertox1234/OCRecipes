---
title: "`TIMESTAMP WITHOUT TIME ZONE` round-trip in real-DB tests — compare DB-to-DB"
track: knowledge
category: design-patterns
tags: [testing, drizzle, postgres, timestamp, timezone, integration-tests]
module: server
applies_to: ["server/storage/**/__tests__/**/*.test.ts"]
created: 2026-05-13
---

# `TIMESTAMP WITHOUT TIME ZONE` round-trip in real-DB tests — compare DB-to-DB

## When this applies

Drizzle `timestamp("col_name")` maps to PostgreSQL `TIMESTAMP WITHOUT TIME ZONE`. When you write a JS `Date` through `pg`, the client converts to the local timezone for the wire representation; on read-back, `pg` re-interprets the naive timestamp into a JS `Date`. The round-trip preserves wall-clock fields but **not** the original UTC offset.

## Symptom

An assertion like `expect(stored.getTime()).toBe(originalDate.getTime())` fails by a multiple of 3600000 ms (the local TZ offset in seconds × 1000).

## Why

`TIMESTAMP WITHOUT TIME ZONE` stores the wall-clock components only. The `pg` driver re-interprets the naive timestamp on read using the client's local TZ, so the round-trip loses the original UTC offset. The invariant you actually care about (`COALESCE` preserves the first stamp) is "stored doesn't change between writes," not "stored equals the JS literal you passed in."

## Examples

**Don't:** test append-only / consent-timestamp invariants by comparing the DB-stored value to the input JS literal.

**Do:** compare the DB-stored value to itself across calls.

```typescript
// ❌ Brittle: depends on TZ-preserving roundtrip, which TIMESTAMP doesn't provide
const ts = new Date("2025-01-15T12:00:00Z");
await updateUserProfile(userId, { healthDataConsentAt: ts });
const result = await updateUserProfile(userId, { healthDataConsentAt: backdate });
expect(result.healthDataConsentAt.getTime()).toBe(ts.getTime()); // off by TZ offset

// ✅ Roundtrip-stable: compares two DB-returned values
const first = await updateUserProfile(userId, { healthDataConsentAt: new Date(...) });
const stored = first.healthDataConsentAt; // post-roundtrip value
const result = await updateUserProfile(userId, { healthDataConsentAt: backdate });
expect(result.healthDataConsentAt.getTime()).toBe(stored.getTime());
```

## When this matters

Any real-DB test (using `setupTestTransaction` / `getTestTx`) that writes a `timestamp` column and reads it back for comparison. Also affects audit-log timestamps and any "preserve original value" invariants.

## When this doesn't matter

Mocked tests (the storage call is intercepted before reaching PG, so no TZ conversion happens). The bug only surfaces against a live database.

## Related Files

- `server/storage/__tests__/users.test.ts` — `healthDataConsentAt` COALESCE tests

## See Also

- [Server-stamped, append-only consent / audit timestamps](../conventions/server-stamped-append-only-consent-timestamps-2026-05-13.md)
- [Storage integration tests with transaction rollback](storage-integration-tests-transaction-rollback-2026-05-13.md)
