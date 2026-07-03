---
title: A single-flight lock set after an inserted `await` stops serializing concurrent calls
track: bug
category: logic-errors
module: client
severity: medium
tags: [concurrency, async, race-condition, offline, single-flight, guard, lock]
symptoms: [A "concurrent calls are a no-op" lock-guard test starts failing after an await was added near the top of the guarded function, A function expected to run once fires its side effect (apiRequest/fetch) twice when invoked twice in the same tick]
applies_to: [client/lib/offline-queue-drain.ts, client/lib/**/*.ts]
created: '2026-06-20'
last_updated: '2026-06-20'
---

# A single-flight lock set after an inserted `await` stops serializing concurrent calls

## Problem

A module-level boolean lock implements single-flight ("only one drain at a time"):

```ts
let isDraining = false;
export async function drainQueue() {
  if (isDraining) return;
  isDraining = true;     // must be SYNCHRONOUS with the guard check
  try { /* ... */ } finally { isDraining = false; }
}
```

Adding an `await` **between** the `if (isDraining) return` check and the
`isDraining = true` assignment silently breaks the guard. In this case an auth
gate (`if (!(await tokenStorage.get())) return;`) was inserted before the flag
was set.

## Symptoms

- An existing "concurrent drain calls are no-ops (lock guard)" test flips from
  green to `expected "apiRequest" to be called once, but got 2 times`.
- Two near-simultaneous callers (e.g. a cold-start drain and an
  `onlineManager.subscribe` reconnect drain firing in the same tick) both pass
  the lock check and both run the body.

## Root Cause

`if (isDraining) return` and `isDraining = true` must run in the **same
synchronous turn**. JavaScript is single-threaded, so a sync read-then-set is
atomic. The moment an `await` sits between them, caller A suspends at the await
with `isDraining` still `false`; caller B (invoked before A resumes) reads
`false`, passes the check, and now both proceed. The lock guards nothing.

## Solution

Set the lock **synchronously, before the first `await`**. Move any async gate
(here the auth/token check) inside the `try` so the `finally` still releases the
lock on the gate's early `return`:

```ts
export async function drainQueue() {
  if (isDraining) return;
  isDraining = true;            // synchronous — before any await
  try {
    if (!(await tokenStorage.get())) return;  // early return still releases the lock
    /* ...drain... */
  } finally {
    isDraining = false;
  }
}
```

## Prevention

- A single-flight boolean (or any "set once, check once" guard) MUST be set in
  the same synchronous turn as its check. Never let an `await` separate
  `if (locked) return` from `locked = true`.
- When adding an early-return gate to a guarded async function, put it **inside**
  the existing `try` (after the flag is set) so the `finally` release still runs.
- Keep the "concurrent calls are a no-op" test — it is the canary. If it breaks
  after a seemingly unrelated edit near the top of the function, suspect a newly
  inserted `await` before the flag assignment, not the test.

## Related Files

- `client/lib/offline-queue-drain.ts` — `drainQueue` sets `isDraining` synchronously, then runs the auth gate inside the try
- `client/lib/__tests__/offline-queue-drain.test.ts` — "concurrent drain calls are no-ops (lock guard)" is the regression canary

## See Also

- [Global mutable client singleton lifecycle](../design-patterns/global-mutable-client-singleton-lifecycle-2026-06-19.md) — why the drain has an auth gate at all (identity-safety discipline)
- [Durable write-queue not cleared on auth teardown](durable-write-queue-not-cleared-on-auth-teardown-cross-account-replay-2026-06-19.md) — the H1 fix whose follow-up added the gate that triggered this race
