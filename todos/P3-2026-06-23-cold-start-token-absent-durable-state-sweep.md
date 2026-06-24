---
title: "Sweep durable local state on the cold-start no-token path in useAuth"
status: backlog
priority: low
created: 2026-06-23
updated: 2026-06-23
assignee:
labels: [deferred, auth, offline]
github_issue:
---

# Sweep durable local state on the cold-start no-token path in useAuth

## Summary

`checkAuth()` has a `if (!token)` early branch ([client/hooks/useAuth.ts](../client/hooks/useAuth.ts), near the top of `checkAuth`) that flips auth state to unauthenticated but does **not** call `clearDurableLocalState()`. A force-quit that interrupts a teardown after `tokenStorage.clear()` but before the durable sweep leaves the durable offline queue / persisted query cache on disk with no token — and the next cold launch takes this branch without sweeping them.

## Background

The offline-persistence audit (`docs/audits/2026-06-23-offline-persistence.md`, finding H2) established the invariant that every session-ending path must clear the durable offline mutation queue + persisted query cache so one account's queued writes can't replay under the next account on a shared device. Four paths were covered: `logout`, `expireSession`, `deleteAccount`, and the `checkAuth` dead-token (401) branch. The S2 refactor (this branch) extracted the shared block into `clearDurableLocalState()`, which made a fifth, uncovered path visible: the `if (!token)` cold-start branch.

Reachability is narrow and self-mitigating, which is why this is Low rather than a blocker:

- It requires a teardown to be interrupted by a force-kill in the sub-millisecond await gap between `tokenStorage.clear()` and the durable sweep, **then** a different user to sign in on the same device before any re-validation.
- The durable queue's `initOfflineQueue()` runs `clearStale()` which evicts items older than the 24h TTL, and the persisted query cache has its own maxAge/buster — so stale queued writes age out on their own.

## Acceptance Criteria

- [ ] RED test (TDD): a `checkAuth()` call with `tokenStorage.get()` returning `null` while a durable queue / persisted cache is present asserts `clearOfflineQueue` + `AsyncStorage.removeItem("@ocrecipes_query_cache")` + `queryClient.clear()` are invoked — fails before the fix.
- [ ] `if (!token)` branch calls `await clearDurableLocalState()` before `setState({ ...isAuthenticated: false })`.
- [ ] Existing `useAuth` tests stay green (the common "fresh install, never logged in" cold start still works — the sweep is a no-op on empty queue/cache/in-memory state).

## Implementation Notes

- This is auth code — **never delegate**; implement inline with real-module tests (`docs/rules`/memory: "Auth recurring breakage — treat auth changes as high-risk").
- The fix is one line: `await clearDurableLocalState();` inside the `if (!token)` block, before its `setState`. The helper is contractually non-throwing, so it can't skip the state reset.
- The sweep is cheap and idempotent on the common path: `clearOfflineQueue()` on an empty queue, `removeItem` on an absent key, and `queryClient.clear()` on an empty cache are all no-ops — so unconditionally sweeping here has no downside for the overwhelmingly-common logged-out cold start.
- Consider whether the foreground-resume re-check path shares the same exposure (it routes through the same `checkAuth`, so the fix covers it).

## Dependencies

- Sits on top of the S2 `clearDurableLocalState()` helper (this branch / PR). Land after S2.

## Risks

- Low. The only behavior change is an extra durable sweep on the no-token path; verified no-op for the normal logged-out cold start.

## Updates

### 2026-06-23

- Initial creation. Surfaced by the advisor during the S2 helper extraction; kept out of the S2 commit to preserve it as a pure refactor.
