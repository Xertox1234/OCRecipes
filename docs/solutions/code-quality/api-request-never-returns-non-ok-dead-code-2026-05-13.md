---
title: "apiRequest never returns non-OK — don't re-check res.ok"
track: bug
category: code-quality
tags: [api, client, fetch, dead-code, error-handling, tanstack-query]
module: client
applies_to:
  [
    "client/hooks/**/*.ts",
    "client/screens/**/*.tsx",
    "client/lib/query-client.ts",
  ]
symptoms:
  - Dead `if (!res.ok)` branch in a `mutationFn` or `queryFn` that calls `apiRequest()`
  - Custom error message inside the dead branch never reaches users — they see the raw `"${status}: ${responseBody}"` thrown by `throwIfResNotOk` instead
  - Confusion about whether to `await res.json()` after a non-OK response
created: 2026-05-13
severity: low
---

# apiRequest never returns non-OK — don't re-check res.ok

## Problem

Mutation hooks and query functions that call `apiRequest()` in `client/lib/query-client.ts` often add an `if (!res.ok)` check after the call. That branch is dead code: `apiRequest()` internally calls `throwIfResNotOk(res)` before returning, so it **always throws** on non-OK responses and **never** returns a response where `res.ok` is `false`.

## Symptoms

- Lint/review flags an unreachable branch inside a `mutationFn`
- A custom error message (`"Request failed: ${status}"`) is in the code but users never see it; they get the raw `"${status}: ${responseBody}"` format thrown by `throwIfResNotOk`
- Reviewers ask "why are we reading the body twice?"

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

## Related Files

- `client/lib/query-client.ts` — `throwIfResNotOk` at line 29, `apiRequest` at line 55

## See Also

- [Graceful 404 handling with raw fetch (bypass apiRequest throw)](../design-patterns/graceful-404-handling-raw-fetch-2026-05-13.md)
