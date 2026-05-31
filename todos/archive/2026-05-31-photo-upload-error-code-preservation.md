---
title: "Preserve server ApiError.code in client/lib/photo-upload.ts so FrontLabelConfirm copy map fires"
status: done
priority: low
created: 2026-05-31
updated: 2026-05-31
assignee:
labels: [deferred, react-native, code-quality]
github_issue:
---

# photo-upload.ts discards server error code

## Summary

`client/lib/photo-upload.ts` throws a plain `Error` and discards the server-provided error `code`, so the `code → static copy` map added to `FrontLabelConfirmScreen.tsx` (in the error-message-ux work) never actually fires for upload failures. Make `photo-upload.ts` throw an `ApiError` that preserves the server `code`.

## Background

Surfaced during the `error-message-ux` todo (branch `todo/2026-05-31-error-message-ux`). That todo satisfied its acceptance criteria literally — `FrontLabelConfirmScreen.tsx` now does `instanceof ApiError` discrimination with a code→copy map and a static fallback — but because the upstream `photo-upload.ts` throws a plain `Error`, the discrimination branch is forward-compat only: today it always lands on the static fallback. The real fix lives in the upload module, which was out of scope for that todo.

## Acceptance Criteria

- [ ] `client/lib/photo-upload.ts` throws an `ApiError` (from `@/lib/api-error`) that carries the server-provided `code`, instead of a plain `Error` that drops it.
- [ ] `FrontLabelConfirmScreen.tsx`'s existing `code → copy` map fires for at least one real upload error code (verify which codes the upload route returns).
- [ ] No raw server message, quota detail, model name, or stack trace is surfaced to the user (fallback to static copy for unknown codes).
- [ ] Existing tests pass; add a test asserting `photo-upload.ts` preserves the code on a non-OK response.

## Implementation Notes

- File: `client/lib/photo-upload.ts` — find the throw site(s) that currently build a plain `Error` from the response.
- Pattern: `throw new ApiError(message, code)` mirroring how `apiRequest` constructs `ApiError` elsewhere; the `code` comes from the JSON error body the route returns.
- Cross-check the upload route(s) in `server/routes/photos.ts` for the exact `code` values returned (e.g. `VALIDATION_ERROR`) so the screen's map keys match.
- Related: `client/screens/FrontLabelConfirmScreen.tsx`, `client/lib/api-error.ts`.

## Dependencies

- Conceptually related to `todos/archive/2026-05-31-error-message-ux.md`; not blocking.

## Risks

- Test mocks for the upload flow may assert on plain `Error`; update them to the `ApiError` shape.

## Updates

### 2026-05-31

- Created from the `error-message-ux` deferred warning (M2 forward-compat gap) during `/todo` deferred-warning triage.
