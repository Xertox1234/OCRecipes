---
title: A generation/epoch counter alone can't close a teardown-sweep vs fresh-reader race — pair it with an in-flight-sweep await
track: bug
category: logic-errors
module: client
severity: medium
tags: [concurrency, race-condition, teardown, cross-user-bleed, async-storage, auth-teardown]
symptoms: ['A teardown/clear function stamps a generation/epoch counter and a fresh reader re-checks it, yet a prior user''s per-user data still resurfaces under the next user on a shared device.', 'Resurrection reproduces ONLY when the reader STARTS during the sweep''s async side-effect (e.g. AsyncStorage.removeItem), not when the reader was already in flight before the sweep.', 'The forward-race test (reader in flight, then clear) passes, but a mirror test (clear first, then a fresh reader during the sweep) fails or is missing.']
applies_to: [client/lib/*-storage.ts, client/lib/offline-queue.ts]
created: '2026-06-25'
---

# A generation/epoch counter alone can't close a teardown-sweep vs fresh-reader race — pair it with an in-flight-sweep await

## Problem

A teardown sweep (e.g. `clearHomeActionsState()` on auth logout) nulls its in-memory
caches and bumps a module-level generation counter (`sweepEpoch`). A reader
(`initHomeActionsCache()`) snapshots the counter before its disk read and commits its
result only if the counter is unchanged afterward. This closes the **forward** race — a
reader already in flight when the sweep runs sees the bump and skips its commit.

It does **not** close the symmetric **mirror** race: a fresh reader that *starts* after
the sweep already bumped the counter, but while the sweep's async wipe
(`AsyncStorage.removeItem`) is still in flight. That reader snapshots the
**already-bumped** epoch, reads **pre-wipe stale data** off disk, and its
`sweepEpoch === startEpoch` check **passes** (both sit at the post-bump value) → it
commits the prior user's data. On a shared device this is a cross-user history
resurrection.

## Symptoms

- Stale per-user data resurfaces under the next user despite the epoch guard.
- Only reproduces in the "clear-then-fresh-read" interleaving, not "read-then-clear".
- A mutation test that deletes the epoch check still leaves one race test green
  (because that test exercises the *other* guard).

## Root Cause

An epoch/generation counter only detects a sweep that happens **during** the reader's
lifetime — i.e. one that changes the value **between** the reader's snapshot and its
commit. It is blind to a sweep whose side-effect was **already pending before the reader
started**: the counter was bumped before the reader snapshotted, so snapshot and commit
observe the *same* value and the equality check passes. The counter answers "did a sweep
happen during me?", never "is a sweep's effect still settling?". The second question
needs a different signal.

## Solution

Pair the epoch with a **second, orthogonal guard**: publish the sweep's in-flight
side-effect promise and have the reader **await it before reading the resource**, then
snapshot the epoch **after** the wait.

```ts
let sweepEpoch = 0;
let sweepInFlight: Promise<void> | null = null;

export function initCache(): Promise<void> {
  return (async () => {
    // Mirror-case guard: don't read while a sweep's removeItem is in flight.
    // `while`, NOT `if` — a second sweep can start while we await the first.
    while (sweepInFlight) {
      try { await sweepInFlight; } catch {}
    }
    // Forward-case guard: snapshot AFTER the wait, BEFORE the read.
    const startEpoch = sweepEpoch;
    const raw = await AsyncStorage.getItem(KEY).catch(() => null);
    // Commit only if no sweep ran during the read; else the sweep won → leave nulled.
    if (sweepEpoch === startEpoch) cache = parse(raw);
  })();
}

export async function clearCache(): Promise<void> {
  sweepEpoch++;            // sync: invalidate any in-flight reader's pending commit
  cache = null;            // sync: getters return empty immediately
  const sweep = AsyncStorage.removeItem(KEY).catch(() => {}).then(() => {});
  sweepInFlight = sweep;   // publish for the mirror-case await
  void sweep.finally(() => { if (sweepInFlight === sweep) sweepInFlight = null; });
  await sweep;
}
```

`sweepEpoch` closes the forward case (sweep during the read); the `sweepInFlight` await
closes the mirror case (reader starts during the sweep). The two are independent — each
covers a window the other cannot.

The whole correctness argument rests on two **synchronous-before-await** spans that JS
run-to-completion makes atomic: `sweepEpoch++; cache = null` in clear, and the
`while`-exit → `const startEpoch` in the reader. Inserting any `await` into either span
silently reopens a race (same failure family as the single-flight `sync-lock` gotcha).

## Prevention

- When a guard protects against a sweep-vs-read race, write **both** a forward test
  (reader in flight, then clear) **and** a mirror test (clear first, then a fresh reader
  *during* the sweep's deferred side-effect). The mirror test must use a **deferred**
  `removeItem` + a **call-time-lazy** `getItem` so a non-waiting reader genuinely reads
  stale data — otherwise it passes vacuously.
- **Mutation-test each guard independently**: delete one guard → exactly one test must
  fail; restore. If deleting a guard breaks no test, the guards aren't orthogonally
  covered and one is masking the other.
- A generation counter is necessary but not sufficient for teardown safety whenever the
  sweep's wipe is asynchronous and the reader re-reads the underlying store per call
  (non-memoized). If the reader is permanently memoized (reads once per process), it
  structurally can't hit either window.

## Related Files

- `client/lib/home-actions-storage.ts` — the two-guard implementation (`sweepEpoch` + `sweepInFlight`)
- `client/lib/__tests__/home-actions-storage.test.ts` — forward + mirror race tests, each pinning one guard

## See Also

- [teardown-sweep-must-serialize-against-startup-repersist](teardown-sweep-must-serialize-against-startup-repersist-2026-06-24.md) — sibling teardown-vs-startup serialization
- [sync-lock-must-precede-first-await-single-flight-guard](sync-lock-must-precede-first-await-single-flight-guard-2026-06-20.md) — the synchronous-before-await atomicity rule this depends on
- [durable-write-queue-not-cleared-on-auth-teardown-cross-account-replay](durable-write-queue-not-cleared-on-auth-teardown-cross-account-replay-2026-06-19.md) — the broader cross-user-bleed-on-teardown class
