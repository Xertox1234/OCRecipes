---
title: 'Serialized teardown sweep: the lock-before-await guards disk only when the startup initializer re-persists'
track: knowledge
category: design-patterns
module: client
tags: [cross-user-bleed, asyncstorage, teardown, lock-before-await, single-flight, auth, client-state]
applies_to: [client/lib/**/*.ts, client/hooks/useAuth.ts]
created: '2026-06-24'
---

# Serialized teardown sweep: the lock-before-await guards disk only when the startup initializer re-persists

## When this applies

You are clearing a **global, non-user-namespaced** durable client key (AsyncStorage
or similar) on session teardown so a prior user's state can't leak to the next user
on a shared device — and a **fire-and-forget startup initializer** reads/writes the
SAME key. The teardown must serialize against that initializer (lock-before-await)
so a late init can't resurrect the swept state. **But what the lock actually
protects depends on whether the initializer re-persists.** Classify it first.

| Initializer behavior | What can resurrect | What the lock guards | Is `removeItem` alone enough for disk? |
| --- | --- | --- | --- |
| **Re-persists** (calls `setItem`/`persist()` after its read) | **Disk** — a late init re-writes the prior data AFTER the sweep's `removeItem` | **Disk resurrection** | **No** — the lock is load-bearing for disk |
| **Read-only** (populates in-memory caches, never `setItem`) | **In-memory caches only** — sync getters return the prior user's data; a later mutation then persists it | A **transient in-memory window** | **Yes** — `removeItem` is the authoritative disk wipe regardless of timing |

Getting this wrong in a comment (or a review) makes the next reader infer a disk
risk that doesn't exist, or — worse — omit the in-memory reset because "removeItem
already clears it," re-opening the bleed via the synchronous getters.

## Smell patterns

- A teardown `clearX()` that only calls `AsyncStorage.removeItem(KEY)` but leaves a
  module-level `xCache` populated — the sync getter still returns the prior user's data.
- A docstring claiming a teardown lock "mirrors `clearOfflineQueue`" without
  checking whether *this* initializer re-persists.
- A global `@app_*` key (no user id in the key) written by one user and read by the
  next on the same device.

## Why

The bleed vector is **data the next user can observe**. That has two surfaces:

1. **Disk** — restored on the next launch/login. Only re-persisting inits can
   resurrect disk after the sweep's `removeItem`, so only then is the lock
   load-bearing for disk (see `clearOfflineQueue`: `initOfflineQueue()` does
   `await persist()`).
2. **In-memory caches** — returned synchronously by getters that back the UI
   (e.g. `useState(getRecentActions)` on mount). A read-only init can repopulate
   THESE after the sweep nulled them, even though disk is already authoritatively
   wiped. So a read-only-init sweep must **null the caches AND `removeItem`**, and
   the lock guards only that in-memory window.

Either way the sweep order is the same defensive shape: **lock-before-await →
null in-memory → remove disk.** The classification tells you which half is
load-bearing and what your comments/tests must assert.

## Examples

Read-only initializer (`client/lib/home-actions-storage.ts`, PR #445) — the lock
guards only the in-memory caches; `removeItem` authoritatively clears disk:

```ts
let initInFlight: Promise<void> | null = null;

export function initHomeActionsCache(): Promise<void> {
  // Capture the load promise SYNCHRONOUSLY (before its first await is observable)
  // so a concurrent clear always sees and awaits it.
  const load = (async () => {
    const [, recentRaw, usageRaw] = await Promise.all([
      /* getItem ×3 — READS only, no setItem */
    ]);
    recentCache = recentRaw ? JSON.parse(recentRaw) : [];
    usageCountsCache = usageRaw ? JSON.parse(usageRaw) : {};
  })();
  initInFlight = load;
  void load.finally(() => { if (initInFlight === load) initInFlight = null; });
  return load;
}

export async function clearHomeActionsState(): Promise<void> {
  if (initInFlight) { try { await initInFlight; } catch {} } // lock-before-await
  recentCache = null;            // null in-memory FIRST (sync getters back the UI)
  usageCountsCache = null;
  await Promise.all([            // removeItem is authoritative for DISK here
    AsyncStorage.removeItem(RECENT_KEY).catch(() => {}),
    AsyncStorage.removeItem(USAGE_COUNTS_KEY).catch(() => {}),
  ]);
}
```

Re-persisting initializer (`client/lib/offline-queue.ts`, PR #444) — the same lock
is load-bearing for **disk** because `initOfflineQueue()` unconditionally
`await persist()`s its merged read; without the lock a late re-persist rewrites the
orphaned queue AFTER the sweep's `removeItem`.

Test implication: for a read-only-init sweep, the **in-memory assertions are the
regression guard** (`expect(getRecentActions()).toEqual([])`). Disk assertions pass
even on the unfixed path (init never `setItem`s), so they're belt-and-suspenders —
say so in the test, and mutation-check by removing the lock to confirm the in-memory
assertion fails.

## Exceptions

- **Memoized single-flight init** (`initPromise ??= …`, as in `offline-queue.ts`)
  is structurally immune to the *mirror* window (init re-running during the sweep)
  because it never re-reads disk. A **non-memoized** init that re-reads per mount
  (as home-actions does, to serve the current session) relies on a gate — e.g. the
  authenticated screen unmounting on the auth-state flip so no init runs during
  teardown. That's a *dependency*, not a structural guarantee; document it or close
  it with an epoch counter (see the deferred P3 todo referenced in
  `home-actions-storage.ts`).
- Keys that are genuinely device-scoped (theme, layout/section-expansion, one-shot
  hint flags) are **not** a bleed and should be retained — clearing them degrades UX
  for no privacy benefit.

## Related Files

- `client/lib/home-actions-storage.ts` — read-only-init example (`clearHomeActionsState`, `initInFlight`)
- `client/lib/offline-queue.ts` — re-persisting-init example (`clearOfflineQueue`, `initOfflineQueue`)
- `client/hooks/useAuth.ts` — `clearDurableLocalState()` chokepoint (all 5 teardown paths)
- `client/lib/__tests__/home-actions-storage.test.ts` — resurrection-race + mutation-checked tests

## See Also

- [teardown-sweep-must-serialize-against-startup-repersist-2026-06-24](../logic-errors/teardown-sweep-must-serialize-against-startup-repersist-2026-06-24.md) — the re-persisting-init bug this generalizes
- [sync-lock-must-precede-first-await-single-flight-guard-2026-06-20](../logic-errors/sync-lock-must-precede-first-await-single-flight-guard-2026-06-20.md) — the lock-before-await rule itself
- [durable-write-queue-not-cleared-on-auth-teardown-cross-account-replay-2026-06-19](../logic-errors/durable-write-queue-not-cleared-on-auth-teardown-cross-account-replay-2026-06-19.md) — the original global-key cross-user replay finding
