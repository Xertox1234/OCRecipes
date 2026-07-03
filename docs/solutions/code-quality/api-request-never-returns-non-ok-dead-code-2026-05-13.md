---
title: apiRequest never returns non-OK — don't re-check res.ok
track: bug
category: code-quality
module: client
severity: low
tags: [api, client, fetch, dead-code, error-handling, tanstack-query]
symptoms: [Unreachable if (!res.ok) branches after apiRequest calls, Dead error-handling code in client data hooks and screens]
applies_to: [client/hooks/**/*.ts, client/screens/**/*.tsx, client/lib/query-client.ts]
created: '2026-05-13'
last_updated: '2026-06-02'
---

# apiRequest never returns non-OK — don't re-check res.ok

## Problem

Mutation hooks and query functions that call `apiRequest()` in `client/lib/query-client.ts` often add an `if (!res.ok)` check after the call. That branch is dead code: `apiRequest()` internally calls `throwIfResNotOk(res)` before returning, so it **always throws** on non-OK responses and **never** returns a response where `res.ok` is `false`.

## Symptoms

- Lint/review flags an unreachable branch inside a `mutationFn`
- A custom error message (`"Request failed: ${status}"`) is in the code but users never see it; they get the raw `"${status}: ${responseBody}"` format thrown by `throwIfResNotOk`
- Reviewers ask "why are we reading the body twice?"
- **Testing blast radius**: Unit tests that mock `apiRequest` with `mockResolvedValue({ ok: false, status, ... })` often assert error messages matching `"${status}: ${text}"` or an `ApiError.code`. These mocks pass against the dead guard but fail after removal because the guard’s error-throwing logic is gone and the mock resolves without throwing. The fix is to change each such mock to `mockRejectedValue(new Error(...))` so its behavior matches the real `apiRequest`’s throw-before-return.

## Root Cause

`apiRequest()` is documented to throw on every non-OK response. The dead `if (!res.ok)` branch usually comes from copy-pasting a raw-`fetch` pattern, where the response object is intentionally available regardless of status.

## Solution

Remove the redundant check. Just parse the response.

```typescript
// Bad: Dead code — apiRequest already threw before reaching this check
mutationFn: async (input) => {
  const res = await apiRequest("POST", "/api/example", input);
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `Request failed: ${res.status}`);
  }
  return res.json();
},

// Good: apiRequest handles errors, just parse the response
mutationFn: async (input) => {
  const res = await apiRequest("POST", "/api/example", input);
  return res.json();
},
```

## Why this matters

1. **Dead code** — the `if (!res.ok)` branch can never execute
2. **Wrong error messages** — `throwIfResNotOk` throws with format `"${status}: ${responseBody}"`, so custom messages like `"Request failed"` are never shown; users see the raw format instead
3. **Double body consumption** — `throwIfResNotOk` reads the body via `res.text()`; if somehow bypassed, a subsequent `res.json()` would fail because the stream is already consumed

## Prevention

When to use this rule:

- Every `mutationFn`, `queryFn`, or `useCallback` load function that calls `apiRequest()`. This includes standalone `loadItems` / `loadCandidates` callbacks — not just React Query hooks.

When NOT to use:

- Raw `fetch()` calls (e.g., FormData uploads, graceful 404 handling) — those do NOT go through `throwIfResNotOk` and the `res.ok` check IS needed.

**Audit line-lists carefully**: A cleanup todo’s enumerated line numbers can mislist raw `fetch()` / `uploadAsync` guards as `apiRequest` guards. Always apply the per-site check: confirm the line directly above the guard is `await apiRequest(`, not `await fetch(` or `await uploadAsync(`, to every listed line rather than trusting the list. For example, the cleanup task for this pattern mistakenly listed lines in `useHistoryData` and `useCarouselRecipes` that were actually raw-fetch live guards. Additionally, removing the last consumer of a query-fn guard that called `throwStatusError` leaves that import unused (remove it) and can orphan `client/lib/throw-status-error.ts` entirely.

## Related Files

- `client/lib/query-client.ts` — `throwIfResNotOk` at line 29, `apiRequest` at line 55
- `client/hooks/useGroceryList.ts`
- `client/hooks/useMealPlanRecipes.ts`
- `client/lib/throw-status-error.ts`

## See Also

- [Graceful 404 handling with raw fetch (bypass apiRequest throw)](../design-patterns/graceful-404-handling-raw-fetch-2026-05-13.md)
