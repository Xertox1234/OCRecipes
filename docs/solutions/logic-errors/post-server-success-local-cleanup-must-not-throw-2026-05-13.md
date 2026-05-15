---
title: "Post-server-success local cleanup must not throw to the caller"
track: bug
category: logic-errors
tags:
  [client-state, auth, error-handling, irreversible-operations, async-storage]
module: client
applies_to: ["client/hooks/**/*.ts", "client/context/**/*.ts"]
symptoms:
  - "User taps Retry after an account-delete error and hits 401 because the account is gone"
  - "Generic 'try again' error surfaces in UI after a successful server mutation"
  - "Local storage rejection propagates through a hook after server already confirmed deletion"
created: 2026-05-10
severity: high
---

# Post-server-success local cleanup must not throw to the caller

## Problem

When a client mutation has irreversible server consequences (account deletion, payment confirmation, etc.), the local cleanup that follows MUST be wrapped to swallow errors. If `tokenStorage.clear()` or `AsyncStorage.removeItem()` rejects after the server has already permanently deleted the account, the rejection propagates back through the hook to the UI — which surfaces a generic "Failed to delete account, please try again" message. The user taps Retry, hits a 401 (account is gone), sees another error, and loses trust in the app.

## Symptoms

- User sees a "failed" error toast immediately after the server returned 200
- The next request from the same client fails with 401 because the account is genuinely gone
- Logs show successful server-side deletion followed by a thrown local-storage rejection

## Root Cause

The hook awaits `apiRequest("DELETE", ...)` (success) and then awaits `tokenStorage.clear()` (rejection). Both awaits live in the same `try` block, so the local-storage rejection bubbles up as a generic error indistinguishable from a server-side failure.

## Solution

Once the server returns success for an irreversible op, treat local cleanup as best-effort:

```typescript
// Good — server success means the caller MUST see success
const deleteAccount = useCallback(async (password: string) => {
  // Server errors propagate so the user can correct + retry.
  await apiRequest("DELETE", "/api/auth/account", { password });

  // Server confirmed deletion. Past this point we cannot let local
  // storage errors surface — the account is gone, retry will 401.
  try {
    await tokenStorage.clear();
  } catch {}
  try {
    await AsyncStorage.removeItem(AUTH_STORAGE_KEY);
  } catch {}
  setState({ user: null, isLoading: false, isAuthenticated: false });
}, []);
```

## Prevention

Whenever a hook awaits an irreversible server call, draw a mental line at the response. Pre-line: errors are recoverable (user retries). Post-line: errors must not propagate; clear local state unconditionally and resolve.

## Related Files

- `client/hooks/useAuth.ts` — `deleteAccount`
- PR account-deletion-flow code review 2026-05-10
