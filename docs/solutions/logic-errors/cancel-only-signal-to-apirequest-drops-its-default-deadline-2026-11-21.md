---
title: "Passing a cancel-only AbortSignal to apiRequest silently drops its 60 s deadline — a hung request then never settles"
track: bug
category: logic-errors
tags: [client-state, react-native, typescript, fetch, timeout, abort-signal, camera]
module: client
applies_to: ["client/lib/query-client.ts", "client/context/**/*.tsx", "client/hooks/**/*.ts"]
symptoms: ["A batch or queued lookup sits in pending forever on a captive portal or half-open socket", "A concurrency-capped queue stalls after N hung requests", "Adding `{ signal }` only to make a request cancellable changed its failure behaviour"]
created: '2026-11-21'
severity: medium
---

# Passing a cancel-only AbortSignal to apiRequest silently drops its 60 s deadline — a hung request then never settles

## Problem

`apiRequest` applies `fetchWithTimeout`'s 60 s default **only when the caller passes no signal** — a caller-supplied signal "owns the request's lifetime". Adding `{ signal: controller.signal }` purely so a request can be *cancelled* therefore also removes its *deadline*.

## Symptoms

Camera audit 2026-11-21 L3: `BatchScanContext` started passing each lookup's AbortController signal so removing an item or clearing the session cancels the network call. The per-fix review caught that a hung lookup now never settles: it holds one of the 3 concurrency slots and its `pendingCount` forever; three of them stall the whole batch.

## Root Cause

`client/lib/query-client.ts`: `init?.signal ? fetch(url, requestInit) : fetchWithTimeout(url, requestInit)`. The default exists so a longer caller deadline (`withDeadline`'s 90 s) is never cut short — correct for callers that pass a *deadline* signal, wrong for callers that pass a *cancel-only* one.

## Solution

A caller that passes a cancel-only signal owns a deadline too, and must tell a timeout apart from a cancel:

```ts
let timedOut = false;
const deadline = setTimeout(() => {
  timedOut = true;
  controller.abort();
}, DEFAULT_REQUEST_TIMEOUT_MS);
const cancelled = () => controller.signal.aborted && !timedOut;
try {
  const res = await apiRequest("GET", url, undefined, { signal: controller.signal });
  if (cancelled()) return;
  // ...
} catch (err) {
  if (cancelled()) return; // user cancel: silent
  // timeout or real failure: visible, retryable
} finally {
  clearTimeout(deadline);
}
```

## Prevention

- When adding `{ signal }` to an `apiRequest` call, ask whether the signal is a deadline or only a cancel. If only a cancel, add the deadline as above.
- Test it: a mock that never settles plus fake timers past `DEFAULT_REQUEST_TIMEOUT_MS` must fail the item and free its slot.

## Related Files

- `client/context/BatchScanContext.tsx`
- `client/lib/query-client.ts`
- `client/lib/fetch-timeout.ts`

## See Also

- `docs/solutions/design-patterns/client-fetch-deadline-composed-with-caller-signal-2026-10-30.md`
- `docs/solutions/logic-errors/expo-fetch-abort-rejects-as-a-plain-error-name-the-outcome-yourself-2026-11-19.md`
