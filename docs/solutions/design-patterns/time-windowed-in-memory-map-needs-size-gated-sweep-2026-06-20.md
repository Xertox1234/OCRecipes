---
title: 'Time-windowed in-memory throttle Map needs a size-gated sweep, not delete-on-empty'
track: knowledge
category: design-patterns
module: server
tags: [security, memory-exhaustion, in-memory-store, throttle, dos, rate-limiting]
applies_to: [server/services/email.ts, server/services/**/*.ts]
created: '2026-06-20'
---

# Time-windowed in-memory throttle Map needs a size-gated sweep, not delete-on-empty

## When this applies

A module-level `Map` used as a sliding-window throttle or TTL cache, where the
value is a per-key list pruned on access — e.g. `recipientSends` in
`server/services/email.ts` (`Map<string, number[]>` mapping a recipient email to
its recent send timestamps, the per-recipient email cap). The per-key timestamp
array is filtered to the window on every access, but a Map **key** is added per
distinct key for the process lifetime.

## Rule

- Pruning the per-key array on access does **not** bound the **key set**.
  Deleting a key only when its filtered array becomes empty (delete-on-empty,
  inside the access path) fails under the **enumeration / single-touch** case: a
  key touched exactly once and never revisited is never re-examined, so its
  stale entry persists. Each distinct key is `set` once with a fresh timestamp
  and never reached again — the empty-check never fires for it. Under recipient
  enumeration (or any high-cardinality single-touch key space) the key set grows
  unbounded → memory-exhaustion DoS, even though every value array is tiny.
- Add a **size-gated lazy sweep**: when `map.size` exceeds a threshold, iterate
  the map and delete every key whose **entire** array is expired
  (`times.every((t) => now - t >= WINDOW_MS)`). Keep delete-on-empty as well.
- Eviction must be **expiry-based only** — never a hard max-size cap that
  force-evicts an **active** key. Evicting an active key resets that key's count
  and **weakens the throttle** (a security regression: it lets a capped
  recipient receive more mail). The todo's own "swap to an LRU/TTL cache" note is
  a trap here; an LRU evicts by recency, not expiry, so it can drop a live count.
- The sweep predicate (`>= WINDOW_MS`, fully expired) is the exact **complement**
  of the access-path filter predicate (`< WINDOW_MS`, still active). Keep them
  complementary so the two can never disagree on a single timestamp and the sweep
  can never drop a live count.

## Why

The size-gated sweep is O(n) per call only while `size > threshold`, and per-key
arrays are bounded (cap 5), so each scan is microseconds even at n in the low
thousands. This **downgrades** the prior unbounded-growth OOM (fatal, never
drains) into transient, self-draining CPU that recovers once enumeration pauses —
a strict improvement, not a new amplification.

## Examples

```typescript
const WINDOW_MS = 60 * 60 * 1000;
const SWEEP_THRESHOLD = 1000;
const store = new Map<string, number[]>();

function sweepExpired(now: number): void {
  for (const [key, times] of store) {
    // Fully-expired predicate is the complement of the access-path filter below.
    if (times.every((t) => now - t >= WINDOW_MS)) store.delete(key);
  }
}

function canSend(key: string): boolean {
  const now = Date.now();
  if (store.size > SWEEP_THRESHOLD) sweepExpired(now); // size-gated, lazy
  const times = (store.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (times.length === 0) store.delete(key); // delete-on-empty (re-added on send)
  if (times.length >= MAX) {
    store.set(key, times);
    return false;
  }
  times.push(now);
  store.set(key, times);
  return true;
}
```

Optionally time-gate the sweep (a `lastSweep` timestamp, run at most once per N
seconds) to remove even the per-call O(n) cost during a sustained burst.

## Exceptions

- A multi-instance deployment needs a shared store (Redis) — a per-process
  in-memory throttle does not coordinate across instances. Out of scope until the
  scaling trigger fires (see deferred-architecture notes).

## Testing

Eviction is **not behaviorally observable** — an expired-but-present key and an
absent key throttle identically — so a test-only export is justified to assert
`.size`. Follow the project convention (`server/services/coach-warm-up.ts`):
`export const _testInternals = { ... }` with the comment
`Test-only internals — never import from production code`. With the existing
`vi.resetModules()` + dynamic `await import(...)` harness, each import yields a
fresh map; accumulate all recipients within a **single** import instance, advance
fake timers past the window, then make **one more** call to trigger the
size-gated sweep (a passive map never evicts on its own).

## Related Files

- `server/services/email.ts`
- `server/services/__tests__/email.test.ts`
- `server/services/coach-warm-up.ts`

## See Also

- [Bounded in-memory store pattern (per-user + global caps)](bounded-in-memory-store-pattern-2026-05-13.md)
- [Credential-keyed failed-attempt throttle (per-account login lockout)](credential-keyed-failed-attempt-throttle-2026-06-10.md)
