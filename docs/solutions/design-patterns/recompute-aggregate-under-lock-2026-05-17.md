---
title: "Recompute caller-derived aggregates inside the transaction under a lock"
track: knowledge
category: design-patterns
tags:
  [
    database,
    postgres,
    drizzle,
    advisory-lock,
    race-condition,
    aggregate,
    lost-update,
  ]
module: server
applies_to: ["server/storage/**/*.ts"]
created: 2026-05-17
---

# Recompute caller-derived aggregates inside the transaction under a lock

## When this applies

A route reads some state, computes a derived aggregate from it (a count, a
level, an averaged value), then calls a storage function that persists those
caller-supplied values. Under concurrency this is a lost-update race: two
requests read the same pre-write state, compute the same aggregate, and both
write it — so N concurrent writers leave the aggregate reflecting only one of
them.

A lock alone does not fix this. Serializing the _writes_ still persists a
_stale_ value, because the value was computed from a snapshot taken before the
lock was held. The aggregate must be **recomputed from the source-of-truth rows
after the mutating insert, inside the same transaction, under the lock**.

This was found in `submitVerification`: the route computed
`verificationLevel` / `verificationCount` / `consensusNutritionData` from a
pre-submit read of `verification_history`, then storage wrote them. Five users
verifying the same barcode concurrently left `verification_count = 2`.

## Why

- `READ COMMITTED` (PostgreSQL default) gives each transaction its own
  snapshot — concurrent transactions do not see each other's uncommitted
  inserts, so each computes its aggregate from a stale row set.
- The fix has two parts that must go together:
  1. `pg_advisory_xact_lock(hashtextextended(<key>, 0))` as the **first**
     statement in the transaction — serializes submissions for that key (and
     also covers a first-ever-row parent-insert race).
  2. After the insert, **re-query the source rows and recompute** the
     aggregate. The post-insert row set now includes this transaction's own
     insert and every prior committed one, so the recomputed value is
     authoritative.
- Storage becomes the single authority for the aggregate. The route stops
  computing it; the storage function **returns** the recomputed values for the
  route's response. Drop the now-dead caller-supplied aggregate parameters.
- The post-insert re-query is the correctness mechanism, not an avoidable
  round-trip. The "never re-query after an insert to build the response" rule
  is about reconstructing a row you just wrote from its own insert params — it
  does not apply to reading a _different_ row set (siblings) to derive an
  aggregate under a lock.

## Examples

```ts
// BEFORE — route computes the aggregate, storage trusts it (lost-update race)
const matchingCount = comparison.isMatch ? existing.length + 1 : existing.length;
const newLevel = matchingCount >= THRESHOLD ? "verified" : "single_verified";
await storage.submitVerification(barcode, userId, n, conf, isMatch,
  newLevel, matchingCount, consensusData); // ← caller-supplied aggregate

// AFTER — storage recomputes authoritatively, returns the result
export async function submitVerification(
  barcode: string, userId: string, n: VerificationNutrition,
  conf: number, isMatch: boolean,
): Promise<SubmitVerificationResult> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${barcode}, 0))`,
    );
    // ...ensure parent row, insert history with onConflictDoNothing...
    if (!inserted) return currentAggregate; // duplicate: return unchanged
    // recompute from the authoritative post-insert row set
    const matching = await tx.select(...).from(verificationHistory)
      .where(and(eq(...barcode), sql`is_match IS NOT FALSE`));
    const count = matching.length;
    const level = count >= THRESHOLD ? "verified" : count >= 1
      ? "single_verified" : "unverified";
    await tx.update(barcodeVerifications).set({ verificationLevel: level,
      verificationCount: count, /* ... */ }).where(eq(...barcode));
    return { verificationLevel: level, verificationCount: count, /* ... */ };
  });
}
```

Keep idempotency intact: when the mutating insert is an
`onConflictDoNothing` no-op (duplicate submission), return the _current_
aggregate without re-writing it — a duplicate must not mutate the aggregate.

## Related Files

- `server/storage/verification.ts` — `submitVerification` (the pattern)
- `server/routes/verification.ts` — route consumes the returned aggregate
- `server/lib/verification-consensus.ts` — shared `computeConsensus` /
  `CONSENSUS_THRESHOLD`, placed in `lib/` so storage can import them without
  violating the service→storage dependency direction
- `server/storage/chat.ts` — prior `pg_advisory_xact_lock` precedent

## See Also

- `docs/solutions/design-patterns/advisory-lock-per-user-rate-limiting-2026-05-13.md`
  — advisory lock for a TOCTOU count-then-insert race
- `docs/solutions/best-practices/multi-connection-concurrency-test-harness-2026-05-17.md`
  — how to test a multi-connection race (the single-connection test mock
  cannot exercise it)
