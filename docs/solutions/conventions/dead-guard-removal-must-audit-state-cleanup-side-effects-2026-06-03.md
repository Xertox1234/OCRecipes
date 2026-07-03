---
title: Removing a dead if(!res.ok) guard requires auditing state-cleanup side effects inside the block
track: knowledge
category: conventions
module: client
tags: [dead-code, error-handling, loading-state, client-state, apiRequest]
applies_to: [client/hooks/*.ts, client/components/*.tsx, client/screens/*.tsx]
created: '2026-06-03'
---

# Removing a dead `if(!res.ok)` guard requires auditing state-cleanup side effects inside the block

## Rule

Before deleting a dead `if (!res.ok)` block after `await apiRequest(...)`, read every statement inside it. Any state-cleanup code — loading flags, mutex refs, haptics, navigation — must be moved to the `catch` block, not simply deleted. Removing the guard without migrating its cleanup leaves the component hung in a loading state on failure.

## Why

`apiRequest` throws on non-ok responses, so `if (!res.ok)` after it is unreachable. But developers sometimes put error-path side effects inside that dead block:

```ts
const res = await apiRequest("POST", url, body);
if (!res.ok) {
  setIsLoading(false);          // ← state cleanup
  isActioning.current = false;  // ← mutex reset
  haptics.error();              // ← feedback
  return;
}
// success path
setIsLoading(false);
```

Mechanically deleting the `if` block removes the only place those cleanups ran on failure. The thrown `ApiError` propagates to the `catch` block (or to TanStack Query's error handler if inside a `queryFn`/`mutationFn`), but that `catch` block may not replicate the resets.

## Smell patterns

- A `catch` block that only logs or shows a toast but does not reset `isLoading`, `isPending`, or a mutex ref
- A component that spins forever after a network error that was previously recoverable

## Examples

```ts
// Before (dead guard with cleanup inside):
try {
  const res = await apiRequest("POST", url, body);
  if (!res.ok) {
    setIsLogging(false);
    isActioning.current = false;
    haptics.notification(Haptics.NotificationFeedbackType.Error);
    return;
  }
  const data = await res.json();
  setIsLogging(false);
  onSuccess(data);
} catch (err) {
  toast.error("Failed.");   // ← no state reset!
}

// ✅ After (cleanups migrated to catch):
try {
  const data = await apiRequest("POST", url, body).then(r => r.json());
  setIsLogging(false);
  onSuccess(data);
} catch (err) {
  setIsLogging(false);         // ← migrated
  isActioning.current = false; // ← migrated
  haptics.notification(Haptics.NotificationFeedbackType.Error);
  toast.error("Failed.");
}
```

## Exceptions

If the `catch` block already handles all resets (e.g. a `finally` block), no migration is needed. Confirm by reading the full `try/catch/finally` before deleting.

## Related Files

- `client/components/BeveragePickerSheet.tsx` — reference example where kimi flagged this pattern during the 2026-06-03 ESLint rules PR

## See Also

- [dead-apirequest-guard-hides-broken-error-branch-2026-05-31.md](./dead-apirequest-guard-hides-broken-error-branch-2026-05-31.md) — the root cause: why `if(!res.ok)` after `apiRequest` is always dead
