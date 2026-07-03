---
title: 'Gate AppState foreground re-checks on a hasBeenBackgrounded latch, not state === ''active'''
track: knowledge
category: conventions
module: client
tags: [appstate, react-native, lifecycle, foreground, ios, android, hooks, auth]
applies_to: [client/hooks/**/*.ts]
created: '2026-05-30'
---

# Gate AppState foreground re-checks on a hasBeenBackgrounded latch, not state === 'active'

## When this applies

Any hook that re-runs work (auth re-validation, data refetch, etc.) when the app **returns from the background** via `AppState.addEventListener("change", ...)`.

## Smell patterns

- `if (state === "active") void refetch()` — fires on mount and on transient `inactive → active`, and is the wrong trigger on iOS.
- A `prevState === "background"` guard — misses the iOS resume, which arrives as two events.
- A foreground listener with no in-flight guard, so rapid app-switching stacks concurrent calls.

## Why

`AppState` semantics differ across platforms and a naive `=== "active"` check is wrong on both:

- **iOS resume is two events:** `background → inactive → active`. A `prevState === "background"` check sees `prevState === "inactive"` at the `→ active` step and **misses the resume**.
- **iOS control center / notification shade is `active → inactive → active`** (no real backgrounding). A `prevState !== "active"` check **over-fires** here.
- **Android** emits `active` immediately on mount on many devices, and uses only `active` / `background` — so a bare `=== "active"` **double-fires on launch** (on top of the mount effect's own run).

The robust trigger is a **latch**: set a flag on any `background`, and only re-run when `active` arrives with the flag set. This catches iOS's two-step resume, ignores control-center churn, and ignores the spurious mount-time `active`. Pair it with an in-flight guard so rapid switching collapses to a single run, and remove the subscription on unmount.

(The pre-existing `usePendingReminders.ts` uses the naive `state === "active"` check — acceptable for an idempotent cache invalidation, but the wrong model for anything heavier or correctness-sensitive like auth.)

## Examples

```ts
useEffect(() => {
  let hasBeenBackgrounded = false;
  let inFlight = false;
  const sub = AppState.addEventListener("change", (next: AppStateStatus) => {
    if (next === "background") { hasBeenBackgrounded = true; return; }
    if (next === "active" && hasBeenBackgrounded && !inFlight) {
      hasBeenBackgrounded = false;
      inFlight = true;
      void checkAuth().finally(() => { inFlight = false; });
    }
  });
  return () => sub.remove();
}, [checkAuth]); // checkAuth is a stable useCallback([]) → effect runs once
```

The latch and in-flight flag live as closure-scoped `let`s inside a mount-only effect (stable `useCallback` dep) — no `useRef` needed, since the single handler instance mutates the same closed-over variables for the component's lifetime.

## Exceptions

- Cheap, idempotent foreground work (e.g. `queryClient.invalidateQueries`) can tolerate the naive `=== "active"` check; the latch matters when the work is expensive, has side effects, or must not run on a non-resume transition.

## Related Files

- `client/hooks/useAuth.ts` — the auth foreground re-check effect
- `client/hooks/usePendingReminders.ts` — the simpler (naive) precedent

## See Also

- [client-401-session-expiry-gating-and-local-logout](client-401-session-expiry-gating-and-local-logout-2026-05-30.md) — the session-expiry signal this re-check feeds on a 401
