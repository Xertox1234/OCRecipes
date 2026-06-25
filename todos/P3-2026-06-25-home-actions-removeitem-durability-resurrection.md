---
title: "Close the home-actions removeItem-durability resurrection (failed disk wipe survives restart)"
status: backlog
priority: low
created: 2026-06-25
updated: 2026-06-25
assignee:
labels: [deferred, security, react-native]
github_issue:
---

# Close the home-actions removeItem-durability resurrection (failed disk wipe survives restart)

## Summary

`clearHomeActionsState()` in `client/lib/home-actions-storage.ts` swallows a failed
`AsyncStorage.removeItem` (`.catch(() => {})`, required to keep the teardown sweep
non-throwing). If the wipe genuinely fails, the prior user's `@ocrecipes_recent_actions`
/ `@ocrecipes_action_usage_counts` keys stay on disk, and a later fresh `init` (even
after an app restart) reads them back — resurrecting one user's Home history under the
next user on a shared device. PR #450 made the _timing_ race structural; this is the
orthogonal _durability_ residual it explicitly left out of scope.

## Background

- Filed from the code review of PR #450 (`fix/harden-home-actions-init-epoch-guard`).
  That PR closed the in-session timing races (forward + mirror) via `sweepEpoch` +
  `sweepInFlight`. Those guards protect the in-memory caches within a session.
- The residual is cross-session: on app relaunch, module state (`sweepEpoch`) resets to
  0, so a fresh `init` has NO in-memory signal that disk is stale from a previously
  failed wipe. The keys are global (not user-namespaced) and `login()` does not reset
  them — exactly the same cross-user-bleed vector `clearHomeActionsState` exists to
  prevent, just triggered by a `removeItem` failure instead of a timing window.
- **This is a shared pattern, not unique to home-actions.** The sibling teardown clears
  use the same best-effort `.catch` swallow: `clearOfflineQueue()`
  (`client/lib/offline-queue.ts`) and the `queryClient.clear()` / `AsyncStorage.removeItem`
  steps in `clearDurableLocalState` (`client/hooks/useAuth.ts`). A real fix should be
  evaluated cross-cuttingly, not just patched in one file.
- Probability is low (requires an AsyncStorage write failure — disk full / corruption),
  impact is a privacy bleed. Defense-in-depth, like the parent todo this descends from.

## Acceptance Criteria

- [ ] A failed `removeItem` during teardown cannot resurrect the prior user's
      recent/usage history on the next user's Home — even across an app restart.
- [ ] `clearHomeActionsState` stays contractually NON-THROWING (teardown must not be
      able to skip the auth-state reset that follows it).
- [ ] The chosen mechanism is evaluated against the sibling teardown clears
      (`clearOfflineQueue`, query-cache) for consistency — pick one approach, don't
      diverge per store.
- [ ] Regression test: simulate a failing `removeItem`, then a fresh `init`, and assert
      the caches/getters stay empty.

## Implementation Notes

Candidate approaches (decide via brainstorm — these are not co-equal):

1. **Per-user key namespacing** (cleanest, biggest): key recent/usage by user id so a
   different user simply never reads the prior user's keys; teardown becomes belt-and-
   suspenders rather than the sole guard. Touches every read/write in the module + a
   one-time migration of the legacy global keys.
2. **Persisted "cleared/epoch" tombstone**: write a small marker on clear that `init`
   checks before trusting disk; only trust history written after the latest tombstone.
   Survives restart; smaller blast radius than (1) but adds a disk read to init.
3. **Bounded retry / setItem-empty fallback** on `removeItem` failure: cheapest, but
   probabilistic (a disk-full failure fails the fallback too) — does NOT meet AC #1's
   "structural" bar. Likely insufficient on its own.

Prefer (1) or (2). Whatever is chosen, apply the same reasoning to `clearOfflineQueue`.

## Dependencies

- None hard. PR #450 (the timing-race fix) is the predecessor but is independent —
  this can proceed whether or not #450 has merged.

## Risks

- Low. Current behavior is already correct except under a rare storage-write failure.
- Approach (1) touches the whole module + needs a legacy-key migration — scope it
  carefully and keep the migration idempotent.

## Updates

### 2026-06-25

- Initial creation. Surfaced in the PR #450 review as the known out-of-scope durability
  residual (the timing races were closed structurally; this disk-durability one was not).
