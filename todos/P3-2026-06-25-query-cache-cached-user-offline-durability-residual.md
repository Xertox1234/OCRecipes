---
title: "Close the query-cache cross-user residual on the cached-user offline resume path"
status: backlog
priority: low
created: 2026-06-25
updated: 2026-06-25
assignee:
labels: [deferred, security, react-native]
github_issue:
---

# Close the query-cache cross-user residual on the cached-user offline resume path

## Summary

The durable-owner marker fix (PR for
`P3-2026-06-25-home-actions-removeitem-durability-resurrection`) protects all
three durable stores against a failed-wipe cross-user bleed via a read-time owner
check. But the protection is asymmetric:

- **home-actions** and the **offline queue** each have an INDEPENDENT read-time
  marker gate (`initHomeActionsCache` checks the marker; `drainQueue` checks the
  marker), so they are protected on EVERY auth path.
- the **persisted query cache** has NO independent gate. Its only protection is
  `reconcileDurableOwner` running `queryClient.clear()` in memory, which happens
  on the `login` / `register` / `checkAuth` `/me`-ok paths.

The `checkAuth` network-error **cached-user offline path** (`client/hooks/useAuth.ts`
~line 187) is the one authenticated path that runs neither reconcile nor a
teardown. So on that path the query cache is unprotected.

## Background

Reconcile was deliberately NOT added to the cached-user offline path because a
user switch requires a network login (so that path can't introduce a _different_
user), AND because reconcile's wipe would clear the query cache during an offline
resume — exactly when the user depends on it. That reasoning is fully sound for
home-actions and the offline queue (their independent gates cover them anyway).
It leaves the query cache as the lone gap.

### Trace (ultra-narrow conjunction)

1. User A logs out; the query-cache disk wipe FAILS (disk full) → `@ocrecipes_query_cache`
   keeps A's data, marker stays `"A"`, AUTH blob removed.
2. User B logs in; B's reconcile wipe ALSO fails → marker stays `"A"`; B uses the
   app but triggers no persisted-query write (or the 1s persist throttle hasn't
   fired) → disk cache still holds A's data.
3. B force-quits and reopens OFFLINE.
4. `PersistQueryClientProvider` restores A's disk cache into memory →
   `checkAuth` hits the network-error branch → cached user B → **no reconcile, no
   clear** → B's authenticated Home renders A's restored food-log / daily-summary
   / dietary-profile until the first refetch.

home-actions and the offline queue survive this exact sequence (their gates fire
on `marker "A" !== "B"`); only the query cache bleeds.

- **Not a regression**: the cached-user path cleared nothing before the marker
  fix either. Read-only, self-heals on the first online refetch.
- Probability is very low (requires two consecutive failed wipes + an offline
  cold start). Defense-in-depth, like the parent todo.

## Acceptance Criteria

- [ ] On the cached-user offline resume path, user B never renders user A's
      persisted query-cache data — even after a double-failed wipe + offline
      restart.
- [ ] The chosen fix does NOT gratuitously wipe the _current_ user's offline
      query cache during a legitimate same-user offline resume (the tradeoff that
      kept reconcile off this path originally).
- [ ] Regression test: simulate restored stale cache + `marker !== cachedUserId`
      on the network-error branch and assert the cache is cleared (or not
      trusted) before authenticated surfaces read it.

## Implementation Notes

Candidate approaches (decide via brainstorm):

1. **Conditional clear on the cached-user path**: on the network-error cached-user
   branch, if `getDurableOwner() !== String(cachedUser.id)`, run
   `clearDurableLocalState()` (or just the query-cache clear) before `setState`.
   Wipes A's cache but, on a mismatch, the cache is A's anyway — so the
   same-user case (marker matches) is untouched, satisfying AC #2. This is likely
   the cleanest: it reuses the existing mismatch signal and only clears when the
   cache provably isn't the resuming user's.
2. **Give the query cache an independent read-time gate** like the other two
   stores — e.g. a per-user persister `key`/`buster`. Harder: the provider sits
   above `AuthProvider` and busts only at restore (mount); see the parent plan's
   analysis.

Prefer (1) — it gates on the same `marker !== user` mismatch the other stores
already use, so it preserves the offline-cache for the legitimate same-user resume
while closing the cross-user case.

## Dependencies

- Builds on the durable-owner marker landed by the parent todo's PR.

## Risks

- Low. Approach (1) only clears when ownership already mismatches (the cache isn't
  the resuming user's), so it can't wipe legitimate same-user offline data.

## Updates

### 2026-06-25

- Filed from the advisor review of the durable-owner marker fix. The marker fix
  closed the home-actions/offline-queue paths on EVERY auth path and the query
  cache on the reconcile paths; this is the query-cache residual on the one
  authenticated path (cached-user offline) that runs neither reconcile nor
  teardown.
