---
title: 'Global mutable client singletons holding user data: one design choice spawns a cluster of lifecycle + cross-account bugs'
track: knowledge
category: design-patterns
module: client
severity: high
tags: [architecture, client-state, offline, singleton, async-storage, auth, multi-account, lifecycle, second-app, meta-pattern]
applies_to: [client/lib/offline-queue.ts, client/lib/offline-queue-drain.ts, client/hooks/useAuth.ts, client/App.tsx]
created: '2026-06-19'
---

# Global mutable client singletons holding user data — a design constraint, not four bugs

Meta-pattern from the 2026-06-19 audit of the offline-persistence feature. Four
findings across **security, reliability, and data-integrity** each looked
independent at discovery, but all trace to ONE design choice: the offline queue
is a **global, module-level, mutable client singleton that outlives a session.**
Fixing the findings one at a time treats symptoms; the codifiable lesson is the
design constraint that prevents the whole class.

## When this applies

Any module-level mutable client store that (a) holds user-scoped data, (b)
persists to a single non-namespaced storage key, and (c) is read/replayed later
on a schedule independent of the request that wrote it. Examples: the offline
mutation queue, a draft cache, a pending-upload list, an in-memory entitlement
cache. **Forward-looking:** the second app + web frontend will reuse this offline
infra — treat this as a design rule for new singletons, not just a retrofit.

## The Rule (three disciplines)

A global mutable client singleton holding user data MUST have:

1. **Per-session lifecycle** — cleared on EVERY auth teardown path (`logout`,
   `expireSession`/401, `deleteAccount`), not just `logout`. Enumerate the paths.
2. **Identity safety** — either a per-user storage-key namespace, or bind each
   record to the user/token that created it. A global key + a consumer that
   attaches the *current* token at use-time = cross-account contamination.
3. **Explicit init/launch hook** — don't rely on incidental events to start it.
   Wire a one-shot at launch (and re-persist after any merge-on-load), because
   transition-only event sources (e.g. TanStack `onlineManager`) synthesize no
   event for the already-in-state cold start.

## Why — one choice, four findings

The offline queue is `let queue` (module-mutable) + a single
`@ocrecipes_offline_queue` key + a drain wired to reconnect *transitions*:

| Finding | Severity | Which discipline it violated |
| --- | --- | --- |
| Queue not cleared on teardown → user A's writes replay under user B | High | #1 lifecycle (+ #2 identity) |
| Init merge clobbered storage; mid-load enqueue lost on force-quit | Med/Low | #1 lifecycle (durable side) |
| Drain replays a captured request under the *current* token (residual) | Low (deferred) | #2 identity |
| No drain on cold-start-while-online (`onlineManager` transition-only) | Med | #3 launch hook |

Each PR-time review of the *feature* missed these because the feature is
internally correct — the defects live at the **seam** between the singleton and
the auth/launch lifecycle. A reviewer (or audit) has to reason across the
singleton's whole lifecycle, not just its own module.

## Examples

```ts
// ✗ The trap: global key, module-mutable, replayed with the current token,
//   cleared on no teardown path.
let queue: QueuedMutation[] = [];
const STORAGE_KEY = "@ocrecipes_offline_queue";   // not per-user
// drain → apiRequest(...) attaches whatever token is current at replay time

// ✓ The three disciplines:
// 1. lifecycle: clearOfflineQueue() in logout/expireSession/deleteAccount (clear-first)
// 2. identity: namespace the key per user, OR gate the drain on the enqueuing identity
// 3. launch:  void initOfflineQueue().then(() => { if (onlineManager.isOnline()) void drainQueue(); })
//            and persist() unconditionally after a merge-on-init
```

## Related Files

- `client/lib/offline-queue.ts` — the singleton (`let queue`, global key, init/merge)
- `client/lib/offline-queue-drain.ts` — the replay consumer (current-token attach)
- `client/hooks/useAuth.ts` — the three teardown paths (lifecycle)
- `client/App.tsx` — the launch hook + persist wiring

## See Also

- [Durable write-queue not cleared on auth teardown](../logic-errors/durable-write-queue-not-cleared-on-auth-teardown-cross-account-replay-2026-06-19.md) — finding #1 (the concrete High)
- [Offline persistence reliability gotchas](../best-practices/offline-persistence-reliability-gotchas-2026-06-19.md) — findings #2 and #4 (the concrete reliability set)
- Binding rule form: `docs/rules/client-state.md` (clear durable write-queue on all teardown paths)
