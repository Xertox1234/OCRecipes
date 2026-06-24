<!-- Filename: P2-2026-06-24-durable-sweep-startup-race-deterministic-close.md  (P0=critical … P3=low) -->

---

title: "Make the auth durable-state sweep deterministic vs the startup initializers (close the cross-user replay/rehydrate race)"
status: backlog
priority: medium
created: 2026-06-24
updated: 2026-06-24
assignee:
labels: [security, auth, offline, client-state]
github_issue:

---

# Durable-state sweep races startup init — make the cross-user close deterministic

## Summary

The auth durable-state sweep (`clearDurableLocalState()` in `client/hooks/useAuth.ts`)
runs **concurrently** with two fire-and-forget startup initializers that re-write the
exact keys it is trying to clear, so the cross-user close is **probabilistic, not
deterministic**. Sequence the sweep after those initializers (or gate it on their
completion) so an orphaned offline queue / persisted query cache cannot be resurrected
after the sweep.

## Background

Surfaced by the `security-auditor` review of PR #442 (the cold-start no-token sweep —
`todos/archive/P3-2026-06-23-cold-start-token-absent-durable-state-sweep.md`). The
threat model (offline-persistence audit finding H2): on a **shared device**, every
session-ending path must clear the durable offline mutation queue + persisted TanStack
Query cache, or user A's queued writes replay (authenticated as user B) and A's cached
food-log/dietary data rehydrates under B. The drain's token guards
(`client/lib/offline-queue-drain.ts:158,74`) do **not** cover this case — a fresh later
login presents only the new user's token, so `tokenNow === tokenAtStart` and the
mismatch guard never fires. **The sweep is the load-bearing defense** (see the comment
at `offline-queue-drain.ts:156`).

The race, verified against source:

- **Offline queue.** `client/App.tsx:70` runs `void initOfflineQueue()` at module-eval
  (fire-and-forget; its promise is not exposed). `initOfflineQueue`
  (`client/lib/offline-queue.ts:53-70`) reads disk → `merged = [...parseQueue(raw),
...queue]` → **`await persist()` unconditionally** (line 68). If the sweep's
  `clearOfflineQueue()` (`offline-queue.ts:111`) interleaves between init's read and its
  persist, the orphaned `[A1,A2]` is re-written to disk **after** the sweep's
  `removeItem` — resurrected, then drained under user B at the next login.
- **Persisted query cache.** `PersistQueryClientProvider` (`client/App.tsx:145`; persister
  in `client/lib/query-client.ts` ~435-439) asynchronously restores prior-session data
  into `queryClient` on mount. If restore completes **after** the sweep's
  `queryClient.clear()`, user A's cached data rehydrates in-memory (and the throttled
  persister re-writes it to disk).

This affects **both** the new no-token branch (`useAuth.ts` `if (!token)`, widest window
— only `await tokenStorage.get()` ahead of the sweep) **and** the already-shipped
dead-token branch (`useAuth.ts:93`, narrower window — `await fetch('/api/auth/me')` RTT
ahead of it usually lets init finish first). It is pre-existing; PR #442 did not
introduce or worsen it.

## Acceptance Criteria

- [ ] The durable sweep on the **no-token** branch cannot be undone by a concurrent
      `initOfflineQueue()` re-persist — e.g. expose `initOfflineQueue()`'s promise from
      `client/App.tsx:70` and `await` it before `clearOfflineQueue()` in the sweep path
      (or make `clearOfflineQueue` serialize against init).
- [ ] The **dead-token** branch (`useAuth.ts:93`) gets the same guarantee (shared root
      cause — fix both, don't leave the narrower window open).
- [ ] `queryClient.clear()` in the sweep cannot precede the persister's restore — gate it
      on restoration-complete (e.g. the persister's restore promise / `useIsRestoring`),
      so A's cached data cannot rehydrate after the clear.
- [ ] Regression test drives the **real** `initOfflineQueue` + the sweep **concurrently**
      (or asserts the chosen sequencing) — not merely "sweep was invoked". The current
      PR #442 test mocks `clearOfflineQueue`, so it cannot exercise the race.
- [ ] Existing `useAuth` + offline-queue tests stay green; verify the common
      "fresh install, never logged in" cold start is unaffected (no startup regression).

## Implementation Notes

- **Auth + startup boot order — NEVER delegate; implement inline with real-module tests**
  (`project_auth_recurring_breakage`: route/middleware tests historically mock the wiring
  gap — the regression test here must use real modules, not mocks of the thing under test).
- Exposing `initOfflineQueue()`'s promise: `App.tsx:70` currently does
  `void initOfflineQueue().then(...)`. Capture the promise (module-scoped, awaitable) so
  the no-token branch can `await` it before sweeping. Mind that the immediate cold-start
  `drainQueue()` at `App.tsx:71` is already auth-gated (no-token → returns), so the
  replay risk is the **persisted resurrection surviving until user B logs in**, not the
  immediate drain.
- Consider whether sequencing the sweep after init meaningfully delays the logged-out
  cold-start render path; if so, prefer making `clearOfflineQueue` itself
  init-aware over blocking the auth state transition.
- `clearStale()` (`offline-queue.ts:72`) only evicts items older than the 24h TTL, so a
  freshly-orphaned (<24h) queue is **not** self-mitigated — don't rely on TTL eviction.

## Dependencies

- Best landed after PR #442 merges (the no-token sweep), since this builds on the same
  branch's sweep call. Not strictly blocking — the fix touches the same lines.

## Risks

- Security/privacy (cross-user data) if it triggers, but **low-probability** (compound:
  force-quit mid-teardown → next cold start where the sweep loses the race → a _different_
  user logs in within 24h). Rated HIGH-impact / low-likelihood by the auditor; filed
  medium.
- Touches app startup/boot order on auth code — a sequencing mistake could delay or wedge
  the logged-out cold-start path. Verify the common path empirically.

## Updates

### 2026-06-24

- Initial creation. Filed at the user's direction from the PR #442 security review (the
  cold-start no-token sweep). The one-liner in #442 is a strict improvement but not a
  deterministic close; this todo tracks the deterministic startup-sequencing fix covering
  both the no-token and dead-token branches.
