---
title: "Gate offline queue drain on auth to close residual cross-user replay race"
status: done
priority: low
created: 2026-06-19
updated: 2026-06-19
assignee:
labels: [deferred, security, react-native]
github_issue:
---

# Gate offline queue drain on auth to close residual cross-user replay race

## Summary

`drainQueue` is wired to fire on every reconnect with no auth check. A drain
parked in its retry backoff when user A logs out and user B logs in can replay
A's captured queued write under B's bearer token. The H1 fix (clearing the
offline queue on teardown) closed the wide vector but leaves this narrow
in-flight window open.

## Background

Surfaced during the security review of audit finding H1 (2026-06-19). H1 added
`clearOfflineQueue()` to `logout`/`expireSession`/`deleteAccount` in
`client/hooks/useAuth.ts`, which removes the persisted queue and resets the
in-memory array on teardown. That is a strict improvement: previously the queue
persisted across teardown and drained entirely under the next user on any
post-logout reconnect.

Residual race (pre-existing root cause, not introduced by H1):

- `client/App.tsx` wires `onlineManager.subscribe((isOnline) => { if (isOnline)
void drainQueue(); })` — the drain is NOT gated on auth state.
- In `client/lib/offline-queue-drain.ts` `attemptDrain`, the queue-membership
  guard (`if (!current) return`) runs BEFORE `await wait(delayMs)`. After the
  wait, `apiRequest(...)` calls `tokenStorage.get()` at dispatch time and
  attaches whatever token is now stored.
- So an `attemptDrain` sitting in its 2-8s backoff `wait` when A logs out and B
  logs in will, after the wait, POST A's captured `current.body` under B's
  token. `clearOfflineQueue()` empties the queue but does not abort the
  in-flight attempt.

Window is narrow: requires the item to be on a retry iteration (attempt >= 2,
since `RETRY_DELAYS_MS[0] === 0` so the first attempt has no wait, i.e. a prior
5xx) AND a full logout + relogin inside the 2-8s backoff.

## Acceptance Criteria

- [ ] A drain that begins or is in flight while unauthenticated does not POST
      queued mutations (no token attached / no replay under a different user).
- [ ] An `attemptDrain` whose backoff `wait` is straddled by a teardown +
      relogin does not dispatch the request under the new user's token.
- [ ] Test covers: enqueue under A -> simulate retry-iteration backoff ->
      teardown + login as B -> assert the in-flight item is not POSTed (or is
      POSTed only with A's token / not at all).

## Implementation Notes

Two candidate fixes (either, or both as defense-in-depth):

1. Gate the drain trigger on auth: only `void drainQueue()` when a session token
   is present. Cleanest place is the `onlineManager.subscribe` callback in
   `client/App.tsx`, or have `drainQueue` early-return when `tokenStorage.get()`
   is empty.
2. In `client/lib/offline-queue-drain.ts` `attemptDrain`, re-check
   queue-membership (`loadQueue().find(...)`) AND token presence immediately
   AFTER `await wait(delayMs)` and right before `apiRequest`, not only at the top
   of the loop. Abort if the item was cleared or the token changed.

Note: pin the test deterministically (control the backoff timer / token storage),
never a timing test.

## Dependencies

- None. H1 fix is already merged into this audit branch.

## Risks

- Low. Both candidate fixes are localized to the offline-queue drain path.

## Updates

### 2026-06-19

- Initial creation (deferred from H1 security review).
