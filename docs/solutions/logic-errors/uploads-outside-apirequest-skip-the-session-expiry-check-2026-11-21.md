---
title: "Uploads that bypass apiRequest skip the 401 session-expiry check — a revoked token on the camera path shows only \"try again\""
track: bug
category: logic-errors
tags: [client-state, security, react-native, typescript, camera, auth, upload]
module: client
applies_to: ["client/lib/photo-upload.ts", "client/hooks/**/*.ts", "client/lib/query-client.ts"]
symptoms: ["A photo, label, receipt or menu scan fails with a generic retry message after a password change on another device", "The user is not signed out until some unrelated screen makes an apiRequest call", "Retrying the scan can never succeed"]
created: '2026-11-21'
severity: medium
---

# Uploads that bypass apiRequest skip the 401 session-expiry check — a revoked token on the camera path shows only "try again"

## Problem

The 401 → session-expiry signal has a single chokepoint inside `apiRequest`/`getQueryFn` (and the SSE streams call `notifyIfStreamSessionExpired`). Multipart uploads cannot use `apiRequest` (JSON body), so `client/lib/photo-upload.ts` (expo-file-system `uploadAsync` + raw `fetch`), `useMenuScan` and `useReceiptScan` sent their own bearer and never ran the check.

## Symptoms

Camera audit 2026-11-21 M4: with a revoked/expired token every camera upload showed "Couldn't analyze this photo. Please try again." (or the receipt/menu equivalent), with no sign-out.

## Root Cause

The chokepoint only covers requests that go through it. Every upload path that builds its own `fetch`/`uploadAsync` is a second, uncovered door.

## Solution

Call the shared check right after the response arrives, before any status branching — never re-implement the guards:

- `Response`-based paths: `await notifyIfSessionExpired(response, token)` (exported from `client/lib/query-client.ts`).
- `uploadAsync` (resolves with `{ status, body }` instead of rejecting on 401): `await notifyIfStreamSessionExpired(status, body, token)` — in `photo-upload.ts` this lives in the async `uploadError` builder, awaited at every `throw await uploadError(...)` site.

The three guards in `checkSessionExpiry` (token attached, still the stored token, body code in `SESSION_EXPIRY_CODES`) stay the only gate, so a route's own `UNAUTHORIZED` still never logs out.

## Prevention

- Any new client network call that is not `apiRequest`/`getQueryFn` must call one of the two helpers, with the token it actually sent.
- Test with an `it.each` over every network function in the module (see `client/lib/__tests__/photo-upload.test.ts` "session expiry on photo uploads"), so a new function added without the call fails.

## Related Files

- `client/lib/photo-upload.ts`
- `client/hooks/useMenuScan.ts`
- `client/hooks/useReceiptScan.ts`
- `client/lib/query-client.ts`

## See Also

- `docs/solutions/conventions/client-401-session-expiry-gating-and-local-logout-2026-05-30.md`
