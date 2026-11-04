---
title: "Client fetch deadline: AbortController + setTimeout merged with the caller's signal (Hermes has no AbortSignal.timeout/any), default only when no signal is passed"
track: knowledge
category: design-patterns
module: client
tags: [client-state, typescript, react-native, fetch, timeout, abort-signal, hermes, tanstack-query, reliability]
applies_to: [client/lib/fetch-timeout.ts, client/lib/query-client.ts, client/hooks/useAuth.ts]
created: '2026-10-30'
---

# Client fetch deadline composed with the caller's signal

## When this applies

Any client (`client/**`) network call: `apiRequest`, `getQueryFn`, or a raw `fetch` that must
exist outside them (the `/api/auth/me` bootstrap). The server-side rule
("always `AbortSignal.timeout()`") does **not** transfer — see Why.

## Why

- **React Native's fetch has no default timeout.** Android has no read timeout at all; iOS gives
  up after ~60s idle. A captive portal or half-open connection hangs the request forever, which
  wedges cold-start auth (endless spinner instead of the cached-user offline fallback), the
  offline-queue drain lock, and any pending mutation button.
- **Hermes does not provide `AbortSignal.timeout` or `AbortSignal.any`.** The Node idiom crashes
  or no-ops on device. Use the documented global `AbortController` + `setTimeout`.
- **A default deadline must never shorten a caller's longer one.** `withDeadline` gives recipe
  generation 90s; a blanket 60s would cut it short. So the default applies only when the caller
  passed no signal.
- **`getQueryFn` must forward TanStack's `signal`** from the query context — otherwise unmount,
  `cancelQueries` and key changes don't actually stop the request.

## Examples

```ts
// client/lib/fetch-timeout.ts
export async function fetchWithTimeout(input, init = {}, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const callerSignal = init.signal ?? undefined;
  const onCallerAbort = () => controller.abort();
  if (callerSignal) {
    if (callerSignal.aborted) controller.abort();
    else callerSignal.addEventListener("abort", onCallerAbort);
  }
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);                                  // always release both
    callerSignal?.removeEventListener("abort", onCallerAbort);
  }
}

// apiRequest: caller's own deadline wins
const res = init?.signal ? await fetch(url, requestInit) : await fetchWithTimeout(url, requestInit);

// getQueryFn: forward cancellation AND bound it
async ({ queryKey, signal }) => fetchWithTimeout(url, { headers, signal });

// useAuth bootstrap: short deadline so the offline fallback kicks in
await fetchWithTimeout(`${base}/api/auth/me`, { headers }, AUTH_ME_TIMEOUT_MS); // 10s
```

An abort surfaces as a non-`TypeError` rejection; check how each consumer classifies it (the
offline drain treats only `TypeError` as "still offline").

## Related Files

- `client/lib/fetch-timeout.ts` — `fetchWithTimeout`, `DEFAULT_REQUEST_TIMEOUT_MS` (60s)
- `client/lib/query-client.ts` — `apiRequest`, `getQueryFn`
- `client/hooks/useAuth.ts` — `AUTH_ME_TIMEOUT_MS`
- `client/lib/__tests__/fetch-timeout.test.ts`

## See Also

- [Fetch timeout with AbortSignal for external APIs](../conventions/fetch-timeout-abort-signal-external-apis-2026-05-13.md) — the server-side (Node) rule; `AbortSignal.timeout` is correct there
- [No-timeout SDK needs Promise.race and app-side retry](no-timeout-sdk-needs-promise-race-and-app-side-retry-2026-06-20.md) — when there is no signal to pass at all
