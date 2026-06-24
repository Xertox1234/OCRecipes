---
title: "Harden home-actions init: close the non-memoized re-read race against clearHomeActionsState"
status: backlog
priority: low
created: 2026-06-24
updated: 2026-06-24
assignee:
labels: [deferred, security, react-native]
github_issue:
---

# Harden home-actions init: close the non-memoized re-read race against clearHomeActionsState

## Summary

`initHomeActionsCache()` in `client/lib/home-actions-storage.ts` is intentionally
NON-memoized (re-runs on every Home mount, resetting `initInFlight` to null on
settle). The `clearHomeActionsState()` lock-before-await closes the
"init-in-flight-before-clear" window, but NOT the symmetric "init-begins-after-
clear's-synchronous-cache-null, during the `removeItem` await" window. A stray
init in that window would read disk before `removeItem` lands and repopulate
`recentCache`/`usageCountsCache` (the sync getters that back the Home UI).

## Background

Today this window is UNREACHABLE, so this is a signature footgun, not a live bug:

- `clearDurableLocalState()` (which calls `clearHomeActionsState()`) runs strictly
  BEFORE `setState({ isAuthenticated: false })` on all five teardown paths.
- `useHomeActions` (the only `initHomeActionsCache` caller) is mounted ONLY by
  `HomeScreen`, which lives only inside the `isAuthenticated && !needsOnboarding`
  branch of `RootStackNavigator`. The whole `Main` tree unmounts on auth flip, so
  no init can start concurrently with teardown, and the next init only runs after
  a fresh login re-mounts Home — by which point disk is already empty.

Contrast `client/lib/offline-queue.ts`, whose `initOfflineQueue` is MEMOIZED
(`initPromise ??=`, never re-reads disk) — it structurally cannot have this
window. The home-actions init re-reads disk per mount, so it depends on the auth
gate for safety. A future caller that pre-warms init OUTSIDE the auth gate
(app-start prefetch, a non-Home consumer, an Onboarding surface) would silently
open the resurrection window.

## Acceptance Criteria

- [ ] Either (a) make the re-read race structurally impossible regardless of
      caller, or (b) make the auth-gate dependency explicit and enforced.
- [ ] If (a): have `clearHomeActionsState()` set a "swept" generation/epoch token
      that a subsequently-started init checks before writing to the caches, so an
      init that starts during/after a sweep cannot populate stale data (mirror the
      memoization guarantee without forcing per-process memoization).
- [ ] If (b): add a code comment + a test asserting `useHomeActions` is only
      mounted behind the `isAuthenticated` gate, and document the invariant that
      `initHomeActionsCache` must never be called outside an authenticated tree.
- [ ] Add a regression test for the "init starts after clear's sync null"
      interleaving (the mirror of the existing "init's read races clear" test).

## Implementation Notes

- Files: `client/lib/home-actions-storage.ts`,
  `client/lib/__tests__/home-actions-storage.test.ts`.
- The cleanest fix is an epoch counter: `clearHomeActionsState` bumps a
  module-level `sweepEpoch`; `initHomeActionsCache` snapshots it before its disk
  read and, after the read, only writes the caches if the snapshot still equals
  the current `sweepEpoch` (else the sweep won the race → leave caches null/empty).
  This removes the dependency on the auth gate entirely.
- Keep `clearHomeActionsState` contractually NON-THROWING.

## Dependencies

- None.

## Risks

- Low. Current behavior is already correct under the live auth gating; this is
  defense-in-depth against a future caller.

## Updates

### 2026-06-24

- Initial creation. Filed during security review of branch
  `fix/teardown-clear-home-actions-history` (commit ac5f6efb). The branch fix is
  correct and shippable as-is; this hardens the init signature for future callers.
