---
title: "expo/fetch rejects an abort as a plain Error and drops the reason — a wrapper that aborts must name the outcome itself"
track: bug
category: logic-errors
tags: [client-state, react-native, typescript]
module: client
applies_to: ["client/lib/fetch-timeout.ts", "client/hooks/**/*.ts", "client/lib/query-client.ts"]
symptoms: ["A deliberate cancel (unmount, a newer request superseding an older one) shows 'Something went wrong' on a device but not in tests", "A timeout and a user cancel cannot be told apart in an error classifier", "Code keys on `err.name === \"AbortError\"` and the check never matches on iOS/Android"]
created: '2026-11-19'
severity: medium
---

# expo/fetch rejects an abort as a plain Error and drops the reason — a wrapper that aborts must name the outcome itself

## Problem

Since Expo SDK 57 the global `fetch` on a device is `expo/fetch`. An abort before
the response headers rejects with `FetchError` whose `name` is `"Error"`
(`expo/src/winter/fetch/fetch.ts`, `FetchErrors.ts` sets no name), and the
signal's `reason` is not passed through. Node/whatwg fetch — what Vitest runs —
rejects with `name: "AbortError"`. So every classifier that keyed on
`name === "AbortError"` (the global mutation net's "a cancel is not a failure")
passed in tests and failed on the phone.

## Symptoms

- A receipt scan cancelled by leaving the screen showed the global
  "Something went wrong" toast on device.
- `fetchWithTimeout`'s own deadline and a caller's cancel produced the same
  error, so neither could be classified.

## Root Cause

The wrapper passed fetch's rejection through unchanged and trusted the platform
to label it. Only the wrapper knows WHY it aborted (its timer fired, or the
caller's signal did).

## Solution

Record the cause where the abort happens and throw your own named error
(reliability audit 2026-11-19, M-obs-1):

```ts
let timedOut = false;
const timer = setTimeout(() => { timedOut = true; controller.abort(); }, ms);
try {
  return await fetch(input, { ...init, signal: controller.signal });
} catch (err) {
  if (callerSignal?.aborted) throw requestAbortedError(); // name "AbortError"
  if (timedOut) throw namedError("TimeoutError", `Request timed out after ${ms} ms`);
  throw err;
}
```

Code that aborts its own raw `fetch` (`useReceiptScan`) checks
`controller.signal.aborted` in its catch and rethrows `requestAbortedError()`.

## Prevention

- Test both rejection shapes: `describe.each` over a Node `AbortError` and an
  expo plain `Error("fetch failed: Fetch request has been canceled")`
  (`client/lib/__tests__/fetch-timeout.test.ts`).
- Never classify an abort by the platform's error name; classify by your own
  signal state.

## Related Files

- `client/lib/fetch-timeout.ts` — `fetchWithTimeout`, `requestAbortedError`
- `client/hooks/useReceiptScan.ts`
- `client/lib/query-client.ts` — `shouldSurfaceMutationError`

## See Also

- [expo/fetch FormData parts](../runtime-errors/expo-fetch-formdata-rejects-react-native-uri-parts-2026-10-29.md) — the other expo/fetch-vs-test-runtime divergence
