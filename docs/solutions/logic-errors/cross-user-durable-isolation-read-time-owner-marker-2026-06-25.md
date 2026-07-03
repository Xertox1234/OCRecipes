---
title: 'Cross-user durable-state isolation must anchor on a read-time owner marker, not a teardown wipe'
track: bug
category: logic-errors
module: client
severity: medium
tags: [auth, cross-user, async-storage, shared-device, durability, client-state]
symptoms: [A prior user's Home history / offline queue / persisted query cache surfaces under the NEXT user on a shared device, The bleed survives an app restart — in-memory sweep guards (e.g. an epoch counter) reset to 0 on relaunch and give no protection, Only reproduces when a teardown removeItem genuinely fails (disk full / corruption) and the failure is swallowed by the non-throwing clear]
applies_to: [client/hooks/useAuth.ts, client/lib/durable-owner.ts, client/lib/home-actions-storage.ts, client/lib/offline-queue*.ts]
created: '2026-06-25'
---

# Cross-user durable-state isolation must anchor on a read-time owner marker, not a teardown wipe

## Problem

Several pieces of device-local state outlive a session under **global** (not
user-namespaced) AsyncStorage keys — the Home action history
(`@ocrecipes_recent_actions` / `@ocrecipes_action_usage_counts`), the offline
mutation queue (`@ocrecipes_offline_queue`), and the persisted TanStack Query
cache (`@ocrecipes_query_cache`). On a shared device the only thing keeping one
account's data out of the next was the auth-teardown sweep
(`clearDurableLocalState`), and that sweep is **contractually non-throwing**, so
every `removeItem` is wrapped in `.catch(() => {})`.

If a wipe genuinely fails (disk full / corruption), the prior user's data stays
on disk. A later read — **even after a full app restart** — resurrects it under
the next user. The in-memory race guards added for the in-session timing case
(`sweepEpoch` / `sweepInFlight`) reset to 0 on relaunch, so they do nothing for
this cross-restart durability case.

## Symptoms

- User B sees user A's recent/frequent Home actions, A's queued offline writes
  replay under B's token, or A's cached food-log/summary renders under B.
- Reproduces only after a swallowed `removeItem` failure, and persists across an
  app restart (distinguishing it from the in-session timing races).

## Root Cause

The isolation guarantee was anchored on **a teardown write succeeding**. That is
structurally unsound for two reasons:

1. A teardown `removeItem` (and any compensating clear-time `setItem` "tombstone")
   fails in **exactly the same** disk-full condition it is meant to defend
   against — so a write-based fix is never more reliable than the wipe it
   replaces.
2. `login()` historically cleared **nothing**, so the teardown sweep was the
   *only* barrier between two accounts; one swallowed failure with no retry
   signal = a permanent, undetectable bleed.

## Solution

Anchor trust on **identity at read time**, not on a teardown write. Add a
persisted **owner marker** (`@ocrecipes_durable_owner`) recording the user id the
durable stores are *confirmed clean-for*:

- `reconcileDurableOwner(userId, wipe)` runs on **every authenticated path**
  (login, register, the `checkAuth` `/me` path, **and** the cached-user offline
  resume). It wipes on a mismatch and advances the marker **only after a
  confirmed wipe**, so `owner === X` guarantees no other user's data is present.
  A failed wipe leaves the marker stale → the next auth resolution retries.
- The non-throwing clears now **return a confirmed-wipe boolean**;
  `clearDurableLocalState` ANDs all three and reconcile gates marker advancement
  on it. (Caveat: every store's clear must report its result, or the AND poisons
  to falsy and the marker never advances — the test that catches this seeds the
  clear mocks to resolve `true`.)
- **Gate each store where its data is actually read/egressed, not uniformly at
  init** — because load lifecycles differ:
  - home-actions `init` runs from a post-login hook → it reads the marker and
    loads history only when it matches the active user.
  - the offline queue's `init` runs at **module load, pre-auth**, so its gate
    lives in `drainQueue` (where writes egress under an identity) — the
    cold-start drain fires before `checkAuth` reconciles.
  - the query cache restores via a provider **above** the auth context, so it
    has no independent gate; reconcile's in-memory `queryClient.clear()` (behind
    the restore gate) covers it, and reconcile on the cached-user offline path
    closes the one authenticated path that otherwise ran neither reconcile nor
    teardown.

Because reconcile only wipes on a **mismatch**, a legitimate same-user offline
resume is a no-op that preserves the offline cache — the feared "wipe the cache
the user depends on" tradeoff only ever bites the already-accepted edge cases
(first-upgrade legacy reset, persistent disk failure), never the common path.

## Prevention

- For any **global-keyed** durable store cleared only on teardown, treat the
  teardown wipe as best-effort cleanup, not the isolation guarantee. The
  guarantee is a read-time owner check whose marker advances only after a
  confirmed wipe.
- A `clear*` helper that swallows failures and has no read-time counterpart is
  the tell. Reject clear-time tombstones/retries as "structural" — they share
  the failure mode.
- Regression tests must simulate a **restart** (`vi.resetModules()` to reset
  in-memory guards to 0) plus a failed `removeItem`, then init/drain as a
  *different* user and assert empty — a test that leaves module state intact only
  exercises the in-memory guards and proves nothing about cross-restart
  durability.

## Related Files

- `client/lib/durable-owner.ts` — the marker control plane (`getDurableOwner`,
  `getActiveUserId`, `reconcileDurableOwner`).
- `client/hooks/useAuth.ts` — `clearDurableLocalState` (now boolean) +
  `reconcileOwnerFor` at login / register / `checkAuth` `/me` / cached-user.
- `client/lib/home-actions-storage.ts` — owner-gated `initHomeActionsCache`.
- `client/lib/offline-queue-drain.ts` — owner gate in `drainQueue`.

## See Also

- [teardown sweep must serialize against startup re-persist](teardown-sweep-must-serialize-against-startup-repersist-2026-06-24.md) — the in-session timing-race predecessor (forward case).
- [epoch counter alone misses the sweep-vs-fresh-read race](epoch-counter-alone-misses-sweep-vs-fresh-read-race-2026-06-25.md) — the in-session timing-race predecessor (mirror case); this doc is the cross-restart durability layer those two left open.
