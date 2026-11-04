---
title: "Make idempotent offline mutations survive an app restart (setMutationDefaults)"
status: done
priority: low
created: 2026-10-30
updated: 2026-10-31
assignee:
labels: [deferred, reliability, client-state]
github_issue:
---

# Make idempotent offline mutations survive an app restart

## Summary

Only the three food-log hooks write through the durable offline queue. About 30 other `useMutation` sites pause while offline (TanStack's default `networkMode: "online"`). That pause lives in memory only, so a force-quit or OS kill drops the write. Opt the safe-to-replay mutations into durable resume.

## Background

This is the remainder of reliability-audit finding R19 (2026-10-30, Low). The same audit PR (`claude/reliability-client-offline`) already shipped:

- **Feedback.** `subscribeToPausedMutations` in `client/lib/query-client.ts` and an info toast in `QueryErrorToastBridge` ("You're offline. This will finish when you reconnect."), sent once per offline stretch, so an offline tap no longer looks like a dead spinner.
- **Infrastructure (N4).** `shouldDehydrateResumableMutation` persists a paused mutation only when a default `mutationFn` is registered for its `mutationKey`. `handleQueryCacheRestored` resumes restored paused mutations in the provider's `onSuccess`.

What is still missing is the per-mutation opt-in. Until a mutation has a `mutationKey` and a `queryClient.setMutationDefaults(key, { mutationFn })`, it is not persisted, and a kill loses it. This was deferred because it needs a product decision for each mutation: which writes are safe to replay minutes or hours later, possibly after server state has moved on. A grocery check-off or a favourite toggle probably is. A meal-plan reorder or a cookbook edit may not be. It also needs a mechanical change at each call site.

TanStack Query v5 docs, guides/mutations.md, "Persist mutations": "we need a default mutation function so that paused mutations can resume after a page reload".

## Acceptance Criteria

- [x] Inventory the non-queue-backed `useMutation` sites and classify each one as replay-safe (idempotent or last-write-wins) or not
- [x] For each replay-safe mutation: give it a stable `mutationKey` and register `queryClient.setMutationDefaults(key, { mutationFn })` at module scope, before the persister restores (for example in a `client/lib/mutation-defaults.ts` imported by `query-client.ts`). The `mutationFn` must take only serializable variables
- [x] Replay-unsafe mutations either opt out with `networkMode: "always"` plus an offline guard, or stay in-memory-paused (documented)
- [x] Tests: a paused, keyed mutation is dehydrated; after a simulated restore plus `resumePausedMutations` it runs its default `mutationFn`

## Implementation Notes

- Persist and resume wiring is already in place: `shouldDehydrateResumableMutation` and `handleQueryCacheRestored` in `client/lib/query-client.ts`, wired in `client/App.tsx`. A mutation becomes durable as soon as it has a default `mutationFn` registered for its key.
- The `mutationFn` cannot close over component state. Everything it needs must be in `variables`.
- Cross-user safety: the persisted query cache is already swept on auth teardown (`clearDurableLocalState` in `client/hooks/useAuth.ts`). Confirm that the sweep also drops persisted paused mutations (`queryClient.clear()` clears the mutation cache) before shipping any.

## Scope Contract

- **Mechanisms to use:** TanStack `setMutationDefaults` plus the existing `shouldDehydrateResumableMutation` gate. Nothing new.
- **Files in scope:** `client/lib/query-client.ts`, a new `client/lib/mutation-defaults.ts`, the hooks owning the chosen mutations under `client/hooks/`, and their `__tests__/`.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- Product call on which mutations are replay-safe.

## Risks

- A replayed write against server state that changed in the meantime (stale reorder or edit).
- A mutation that captures non-serializable variables silently fails to resume.

## Updates

### 2026-10-30

- Initial creation (deferred remainder of reliability audit R19)

### 2026-10-31

- Owner ruling (the product call this todo depended on): **only on/off toggles** survive a restart — grocery check-offs, favourites and similar idempotent / last-write-wins toggles. Creates (duplicate risk), edits, reorders and deletes stay in-memory-paused (documented), not replayed.

### 2026-11-01

- Done. Four on/off toggles are durable (grocery check-off, recipe favourite, scanned-item favourite, conversation pin), registered in `client/lib/mutation-defaults.ts` and loaded from `query-client-persistence.ts` (a one-way import; `query-client.ts` importing it would be circular). The full `useMutation` classification is the header comment of that file. `useSetRecipeTried` is an explicit-state toggle left in-memory: its recipe id lives only in the key, so it needs its variables reshaped first. `queryClient.clear()` clears the mutation cache, so the auth-teardown sweep already drops persisted paused mutations; covered by a test.
