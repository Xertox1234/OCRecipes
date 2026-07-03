---
title: 'User-facing error copy: branch on ApiError.code, never render error.message'
track: knowledge
category: conventions
module: client
tags: [error-handling, client, tanstack-query, apierror, accessibility, ux]
applies_to: [client/screens/**/*.tsx, client/components/**/*.tsx, client/hooks/**/*.ts, client/lib/throw-status-error.ts, client/lib/photo-upload.ts, client/hooks/useCoachStream.ts]
created: '2026-05-31'
last_updated: '2026-06-02'
---

# User-facing error copy: branch on `ApiError.code`, never render `error.message`

## Rule

In React Native UI (rendered text, `AccessibilityInfo.announceForAccessibility`,
`setError` state), **never** surface a query/mutation `error.message` directly to
the user. Render static, user-safe copy and discriminate code-specific messages
on `error instanceof ApiError && error.code === "<CODE>"`.

A query/mutation fn that throws only a bare status (`throw new Error(\`${res.status}\`)`)
must be upgraded to throw a **code-carrying** `ApiError` so screens can branch on
`.code`. Use the shared `throwStatusError(status)` helper in
`client/lib/throw-status-error.ts` (maps `404 -> NOT_FOUND`, everything else ->
`INTERNAL_ERROR`).

## Why

The project's `apiRequest()` (`client/lib/query-client.ts`) calls
`throwIfResNotOk()`, which throws `new ApiError("${status}: ${responseBody}", code)`
-- so on a real failure `error.message` is the **raw server response**: `"500: ..."`,
internal quota/model details, stack-ish text. Rendering it leaks internals and is
not user-friendly.

A second, subtler bug this prevents: branching a screen's UI on
`error.message === "404"` **never matches production**, because the production
message is `"404: <body>"`, not `"404"`. The bare-status throw inside a hook's own
`if (!res.ok)` guard is _also_ effectively dead code in production (apiRequest
throws first), but it **is** exercised by tests that mock `apiRequest` to return
`{ ok: false, status }`. Throwing a code-carrying `ApiError` from that guard keeps
the mocked-test path and the production path in agreement on `.code`, so an
`error.code === "NOT_FOUND"` check works in both. (`createQueryWrapper` sets
`retry: false`, so a `"Not found"` message -- no `4\d\d:` prefix -- won't trigger the
global retry guard in tests.)

## Examples

```ts
// client/lib/throw-status-error.ts -- shared helper
export function throwStatusError(status: number): never {
  const code = status === 404 ? ErrorCode.NOT_FOUND : ErrorCode.INTERNAL_ERROR;
  throw new ApiError(status === 404 ? "Not found" : "Request failed", code);
}

// hook queryFn -- bare status -> code-carrying ApiError
const res = await apiRequest("GET", `/api/meal-plan/grocery-lists/${listId}`);
if (!res.ok) throwStatusError(res.status); // was: throw new Error(`${res.status}`)

// screen -- branch on .code, NOT .message
const isNotFound =
  isError && error instanceof ApiError && error.code === "NOT_FOUND"; // was: error.message === "404"

// rendered / announced error -- static copy, never error.message
const isLimit = err instanceof ApiError && err.code === "DAILY_LIMIT_REACHED";
AccessibilityInfo.announceForAccessibility(
  isLimit ? "Daily suggestion limit reached" : "Something went wrong. Please try again.",
);
```

## When NOT to apply / gotcha

- Leave the `${status}: ${text}` **mutation** throws alone -- their message format is
  part of the tested contract (`expect(error.message).toBe("422: ...")`). Only the
  bare status-only throws need converting.
- **Resolved: photo-upload.ts now throws a code-carrying `ApiError`.**  
  The file `client/lib/photo-upload.ts` was updated to no longer discard the server
  code. It now uses an in-file shared helper `uploadError(status, body)` that parses
  the standard error body (`{ error, code? }`) and returns
  `new ApiError("Upload failed: " + status, code)` — the message is **static**
  (never interpolating the raw server body), preserving user safety while delivering
  the machine-readable code to the screen. The four fetch-based confirm/follow-up
  helpers in that file (`submitFollowUp`, `confirmPhotoAnalysis`,
  `confirmLabelAnalysis`, `confirmFrontLabel`) now throw
  `new ApiError(errorData.error || fallback, errorData.code)`.
  As a result, the screen's code-to-copy map (e.g. in `FrontLabelConfirm`) fires for
  real codes like `VALIDATION_ERROR`, `AI_NOT_CONFIGURED`, or `NOT_FOUND` returned
  by `server/routes/verification.ts`.  
  **But note:** A screen copy map must key on codes the route **actually** emits —
  the prior placeholder key `CONFLICT` was never returned by the front-label routes,
  so the map never fired. Always verify that the codes in the map match the server’s
  `ErrorCode` enum values.  
  **Implementation lesson:** During the bulk conversion, `uploadPhotoForAnalysis`
  had a slightly different non-200 block (an extra comment line), so a `replace_all`
  skipped it on the first pass. When sweeping near-identical throw sites, verify each
  one was actually converted — a visual diff or explicit grep is safer than trusting
  a global search-and-replace.
- **NON-apiRequest error source (e.g., XHR/SSE coach stream):** When an error
  callback (like `onError` in `useCoachStream`) receives only a raw string like
  `'<status>: <body>'`, it cannot be branched on `.code` because there is no
  `ApiError` object. Thread the machine-readable code through by parsing the
  standard error body (`{ error, code? }`) at the non-200 site and widening the
  callback signature to accept `(msg: string, code?: string)`. The consumer then
  branches on `code` (e.g. `DAILY_LIMIT_REACHED`) and in the else-branch sets
  **static copy**, never the raw `msg`. Previously `CoachChatBase` rendered
  `streamingError` raw via `InlineError`, so the old `else { setStreamingError(message) }`
  was a real information leak, not merely fragile.
- **Verify codes against the exact route (reinforced):** During `Error-message UX
  round 2`, `LabelAnalysisScreen`’s confirm `onError` initially branched on
  `LIMIT_REACHED`, but the route `/api/photos/confirm-label` actually emits only
  `NOT_FOUND` (expired session) and `RATE_LIMITED` (via `crudRateLimit`) plus
  `INTERNAL_ERROR` (via `handleRouteError`). `LIMIT_REACHED` is emitted by a
  **different** `/api/photos/confirm` route. A wrong code makes the specific branch
  dead code that silently falls to the generic fallback. Always read the **exact**
  route the client helper targets, not a similarly-named sibling.

## Related Files

- `client/lib/throw-status-error.ts` -- shared status-only -> `ApiError` helper
- `client/lib/query-client.ts` -- `throwIfResNotOk` builds `ApiError("${status}: ${body}", code)`
- `client/lib/api-error.ts` -- `ApiError` class (`code?: string`)
- `shared/constants/error-codes.ts` -- `ErrorCode` constants
- `client/hooks/useGroceryList.ts` -- `useGroceryListDetail` throws `throwStatusError`
- `client/screens/meal-plan/GroceryListScreen.tsx` -- `isNotFound` branches on `error.code`
- `client/components/MealSuggestionsModal.tsx` -- static error copy + `DAILY_LIMIT_REACHED` branch
- `client/lib/photo-upload.ts` -- `uploadError()` helper builds a code-carrying `ApiError` with a static `"Upload failed: <status>"` message
- `client/hooks/useCoachStream.ts` -- XHR/SSE coach stream; parses the non-200 error body and passes `code` as a second `onError` arg
- `client/components/coach/CoachChatBase.tsx` -- renders `streamingError` raw via `InlineError`, so the consumer's else-branch must set static copy (not the raw message)
- `client/components/coach/CoachChat.tsx` -- `onError` branches on `code === DAILY_LIMIT_REACHED`, else static copy
- `client/screens/LabelAnalysisScreen.tsx` -- confirm handler fixed to branch on the codes the confirm-label route actually emits (NOT_FOUND, RATE_LIMITED)

## See Also

- [apiRequest never returns non-OK -- don't re-check res.ok](../code-quality/api-request-never-returns-non-ok-dead-code-2026-05-13.md)
- [ErrorCode constants for machine-readable error codes](error-code-constants-machine-readable-2026-05-13.md)
- [Generic error messages for 5xx responses](generic-error-messages-5xx-2026-05-13.md)
- [Graceful 404 handling with raw fetch](../design-patterns/graceful-404-handling-raw-fetch-2026-05-13.md)
