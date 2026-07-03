---
title: A dead `if (!res.ok)` guard after apiRequest can silently kill a consumer's error branch
track: bug
category: logic-errors
module: client
severity: medium
tags: [apirequest, error-handling, dead-code, client-state, error-codes, tanstack-query]
symptoms: [A 'friendly' error branch (e.g. 'Already Saved') never fires; the generic fallback always shows, 'An `if (!res.ok) { ... throw ... }` block sits right after `await apiRequest(...)`', A consumer matches `error.message === '<exact string>'` and the string is only produced inside that dead block]
applies_to: [client/hooks/*.ts, client/components/*.tsx, client/screens/*.tsx, server/routes/*.ts]
created: '2026-05-31'
---

# A dead `if (!res.ok)` guard after apiRequest can silently kill a consumer's error branch

## Problem

`useAddRecipeToCookbook` did `const res = await apiRequest("POST", ...); if (!res.ok) { if (res.status === 409) throw new Error("Recipe already in cookbook"); ... }`. `CookbookPickerModal` matched that exact string in `onError` to show a friendly "Already Saved" alert. Adding a recipe already in a cookbook showed the generic **"Failed to add recipe. Please try again."** instead.

## Symptoms

- The "Already Saved" alert never appeared; the generic error always did.
- The `if (!res.ok)` block looked like correct error handling.

## Root Cause

`apiRequest()` (`client/lib/query-client.ts`) calls `await throwIfResNotOk(res)` **before** returning `res`. On any non-ok response it throws `ApiError("<status>: <body>", code)`. Therefore:

1. **Every `if (!res.ok)` block after `apiRequest` is unreachable dead code** — `res` is always ok by the time it returns.
2. The `409 → throw new Error("Recipe already in cookbook")` inside that dead block was the **only** producer of the string the consumer matched. So the consumer's `err.message === "Recipe already in cookbook"` branch was *also* permanently dead.
3. The error that actually propagated was `ApiError("409: ...", "VALIDATION_ERROR")` — `.message` is `"409: ..."` (never the matched string), and the code was the **generic** `VALIDATION_ERROR` (reused for ~10 other conditions in the same route), so even a naive `.code` check would over-match.

A later refactor that made `apiRequest` always-throw silently invalidated both the guard and the downstream UX, with no test catching it (the route test only asserted `status === 409`).

## Solution

Three coordinated changes:

1. **Server** — return a *specific* code for the specific condition: `sendError(res, 409, "Recipe already exists in this cookbook", ErrorCode.CONFLICT)` (was `VALIDATION_ERROR`). `CONFLICT` already existed and is the convention in `fasting.ts`/`verification.ts`/`auth.ts`.
2. **Hook** — delete the dead `if (!res.ok)` block; the mutationFn is just `return res.json();` (with a comment that `apiRequest` already threw).
3. **Consumer** — branch on `err instanceof ApiError && err.code === ErrorCode.CONFLICT` (import `ApiError` from `@/lib/api-error`, `ErrorCode` from `@shared/constants/error-codes`).
4. **Test** — pin the contract: `expect(res.body.code).toBe("CONFLICT")`, so a future regression to a generic code fails CI.

## Prevention

- **Never write `if (!res.ok)` after `apiRequest()`** — it always throws on non-ok. To detect a specific status, return a *specific* `ErrorCode` server-side and branch the consumer's `onError` on `error instanceof ApiError && error.code === "<CODE>"`. (Codified as a `docs/rules/client-state.md` rule.)
- **Never gate user-facing UX on `error.message`** — match on `error.code`. Message shape changes; codes are the contract.
- When a route condition needs distinct client UX, give it a **dedicated** `ErrorCode` — don't reuse the generic `VALIDATION_ERROR`, which can't be discriminated.
- A 409/4xx route test should assert `res.body.code`, not just `res.status`.

## Related Files

- `client/lib/query-client.ts` (`throwIfResNotOk`, `apiRequest`), `client/lib/api-error.ts`
- `client/hooks/useCookbooks.ts`, `client/components/CookbookPickerModal.tsx`
- `server/routes/cookbooks.ts`, `shared/constants/error-codes.ts`
- `server/routes/__tests__/cookbooks.test.ts`

## See Also

- `docs/solutions/conventions/apierror-code-driven-static-copy-2026-05-31.md` — the consumer-side `.code`-driven copy pattern
- `docs/rules/client-state.md` — apiRequest-always-throws + branch-on-code rules
- The companion cleanup todo `todos/2026-05-31-dead-apirequest-guard-cleanup.md` (~30 other dead guards)
