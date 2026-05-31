---
title: "Extract requireValidImage helper to deduplicate upload guard in photos.ts"
status: backlog
priority: low
created: 2026-05-31
updated: 2026-05-31
assignee:
labels: [deferred, code-quality, api]
github_issue:
---

# Extract requireValidImage helper to deduplicate upload guard in photos.ts

## Summary

Three route handlers in `server/routes/photos.ts` each contain the identical three-step image upload guard: null-file check → magic-byte MIME validation → base64 conversion. Extract a `requireValidImage(req, res)` helper into `_helpers.ts` so each handler collapses to a one-liner.

## Background

Surfaced by `/audit code-quality` on 2026-05-31 as finding M6.

The three-step guard appears verbatim at:

- Lines 125–162 (photo analysis / scan endpoint)
- Lines 466–484 (recipe photo import)
- Lines 532–550 (label photo endpoint)

`server/routes/cooking.ts` line 231 also duplicates the `detectImageMimeType` guard. The pattern is spreading across files, and any future change (e.g. adding WebP support to the allowed MIME types or changing the error code for invalid images) currently requires updating 3–4 call sites.

## Acceptance Criteria

- [ ] `server/routes/_helpers.ts` exports a `requireValidImage(req: AuthenticatedRequest, res: Response): string | null` helper that performs all three steps: null-file check (sendError 400 + return null), MIME validation (sendError 400 + return null), base64 conversion (return the string)
- [ ] All three handlers in `photos.ts` use `requireValidImage` and are reduced to: `const imageBase64 = requireValidImage(req, res); if (!imageBase64) return;`
- [ ] `cooking.ts` line 231 guard also updated to use `requireValidImage` (or at minimum the MIME check uses the same helper)
- [ ] Existing tests for these route handlers still pass; no behaviour change

## Implementation Notes

The helper belongs in `server/routes/_helpers.ts` — that file already houses `sendError`, `requirePremium`, and similar route utilities.

Signature: `requireValidImage(req: AuthenticatedRequest, res: Response): string | null` — returns the base64 string on success, `null` (having already sent the error response) on failure. Callers use the early-return pattern shown above.

The MIME type error messages and error codes are currently identical across all three handlers (`"No photo provided"` / `VALIDATION_ERROR` and `"Invalid image content. Only JPEG, PNG, and WebP allowed."` / `VALIDATION_ERROR`) — consolidation is safe.

## Dependencies

- None

## Risks

- If any handler needs to override the error message or MIME type set (none currently do), the helper would need a config param — keep it simple and add only if a handler diverges

## Updates

### 2026-05-31

- Created from `/audit code-quality` 2026-05-31 finding M6
