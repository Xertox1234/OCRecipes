---
title: 'Hook-level useMutation callbacks need an onMutate-context epoch, not a per-call closure'
track: bug
category: logic-errors
tags: [react-native, tanstack-query, mutations, epoch, generation-counter, client-state]
module: client
applies_to: [client/hooks/**/*.ts]
symptoms: ["A useMutation whose onSuccess/onError are defined at the hook level (not passed to mutate()) writes stale UI state after the session was reset", "A late error from an abandoned submit repopulates an error banner in a session the user already dismissed", "Session already has a per-call epoch guard pattern for one mutation but a sibling mutation with hook-level callbacks has no equivalent guard"]
severity: medium
created: '2026-09-24'
---

## Problem

`useQuickLogSession` already guarded `parseFoodTextMutate` against stale results: each call site captures `const epoch = sessionEpochRef.current;` before calling `mutate()`, then checks `if (sessionEpochRef.current !== epoch) return;` inside the `onSuccess`/`onError` passed as that call's second argument. `reset()` bumps `sessionEpochRef.current` so any parse that resolves after the session was cleared is a no-op.

`logAllMutation`, defined with `useMutation({ onSuccess, onError, ... })` in the same hook, had no equivalent guard. Its `onSuccess`/`onError` are configured once at the hook level — there is no per-`mutate()`-call site to capture an `epoch` closure variable into, because `submitLog` just calls `logAllMutate(parsedItems)` with no options argument. A submit still in flight when the user closed the drawer (`handleToggle` calls `session.reset()` unconditionally) could resolve afterward and its `onError` would call `setSubmitError(...)`, writing a stale "Failed to log items" banner into the now-dismissed session — visible again if the user reopened the drawer.

## Root Cause

The per-call closure epoch pattern only works when the mutation's callbacks are supplied at the `mutate(vars, { onSuccess, onError })` call site, because that is the only place a local variable can be captured per invocation. A `useMutation` configured with hook-level `onSuccess`/`onError` has no such call-site closure — those callbacks are defined once, at hook-setup time, and reused across every `mutate()` call. TanStack Query v5 also has no way to cancel an in-flight mutation from `reset()`/`observer.reset()`: the mutation runs to completion and its own callbacks always fire, so the guard has to be inside the callback, not achieved by preventing the callback from firing.

## Solution

Use `onMutate` to snapshot the epoch into the mutation's `context`, then compare it against the live ref in `onSuccess`/`onError`:

```ts
const logAllMutation = useMutation<
  ScannedItemResponse[] | undefined,
  PartialLogError,
  ParsedFoodItem[],
  { epoch: number }
>({
  mutationFn: async (items) => {
    /* ... */
  },
  onMutate: () => ({ epoch: sessionEpochRef.current }),
  onSuccess: (data, items, context) => {
    if (data !== undefined) {
      // Real write happened — invalidate regardless of session state below.
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.dailySummary });
      // ...other invalidations
    }
    if (context !== undefined && context.epoch !== sessionEpochRef.current) {
      return; // stale — session was reset, skip UI-state writes
    }
    // setParsedItems([]), setInputText(""), setSubmitError(null), etc.
  },
  onError: (error, items, context) => {
    const failedIndices = error.failedIndices ?? [];
    if (failedIndices.length > 0 && failedIndices.length < items.length) {
      // Some items persisted — refresh stale queries. Unconditional: real
      // server-side writes happened regardless of session state below.
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.dailySummary });
      // ...other invalidations
    }
    if (context !== undefined && context.epoch !== sessionEpochRef.current) {
      return; // stale — do not repopulate items or write the error banner
    }
    // setParsedItems(...), setSubmitError(...)
  },
});
```

`onMutate` runs synchronously when `mutate()` is called (before the async `mutationFn`), so it captures the epoch at submit time exactly like the per-call closure does for the parse mutation — it's just carried through TanStack's `context` argument instead of a closure variable. Treat an `undefined` context (defensive — `onMutate` always runs here, but guards against a future refactor that removes it) as **current, not stale**, so a genuine failure/success can never be silently swallowed by a missing context.

Any side effect that reflects a **real, already-persisted server write** (cache invalidation, partial-success invalidation) must stay unconditional and run *before* the epoch check — only the session's own **local UI state** (banners, parsed-item list, input text, success haptic/toast) should be gated on the epoch.

## Prevention

When a `useMutation`'s `onSuccess`/`onError` are configured at the **hook level** rather than per `mutate()` call, and the hook already has (or needs) a generation/epoch ref to guard against a dismissed/reset session, use `onMutate: () => ({ epoch: currentEpochRef.current })` to carry the epoch through `context` — do not try to force a per-call closure pattern onto hook-level callbacks. Before assuming a codebase's existing epoch-guard pattern covers every mutation, check whether each mutation's callbacks are wired per-call or at the hook level; each shape needs a different capture mechanism.

This is the same general bug class as the existing epoch/generation-counter solutions (a stale async completion writing into a value that has since moved on) but a different mechanical trap: those solutions are about *when* to bump the counter; this one is about *how* to capture it when the consuming callback has no per-call closure to capture it into.

## Related Files

- `client/hooks/useQuickLogSession.ts` — `logAllMutation`'s `onMutate`/`onSuccess`/`onError`, `sessionEpochRef`
- `client/hooks/__tests__/useQuickLogSession.test.ts` — "reset during an in-flight submit, then a late error, does not repopulate the submitError banner"

## See Also

- [Token guard must bump at every acquire-eligible transition](token-guard-must-bump-at-every-acquire-eligible-transition-2026-09-01.md) — same general bug class (a generation counter that misses a boundary), different mechanical trap (bump timing, not capture mechanism)
- [A generation/epoch counter alone can't close a teardown-sweep vs fresh-read race](epoch-counter-alone-misses-sweep-vs-fresh-read-race-2026-06-25.md) — same family, in an AsyncStorage teardown-sweep-vs-reader race
