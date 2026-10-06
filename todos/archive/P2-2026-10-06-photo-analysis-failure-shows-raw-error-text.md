---
title: "Photo analysis failure shows raw error text and drops the daily-limit message"
status: done
priority: medium
created: 2026-10-06
updated: 2026-10-06
assignee:
labels: [client, deferred]
github_issue:
---

# Photo analysis failure shows raw error text and drops the daily-limit message

## Summary

When photo analysis fails, the analyze effect in `client/hooks/usePhotoAnalysis.ts` (~L172, the `catch` after `uploadPhotoForAnalysis`) puts `err.message` straight into `setError`. `PhotoAnalysisScreen` then renders it in the error banner (~L492–503). Users see strings like "Upload failed: 429", "Invalid response from server" or "Not authenticated", and possibly native compression/upload error text. This violates the `no-error-message-in-ui` rule.

The worst case is the daily scan limit. `/api/photos/analyze` answers `429` with code `LIMIT_REACHED` ("Daily scan limit reached"). `uploadError()` in `client/lib/photo-upload.ts` (~L90) keeps the code on the `ApiError` but builds the message as `Upload failed: ${status}`. So a free-tier user who hits their limit sees "Upload failed: 429" and is never told why.

## Background

Spotted while fixing the sibling leak in `handleLogSelected` for interaction-feel step 1b (PR #1284; archived todo `P3-2026-10-05-photo-analysis-log-error-leaks-err-message.md`). It was left out of that PR to keep it focused on the log path.

## Acceptance Criteria

- [x] The analyze `catch` maps the error to static copy instead of `err.message`, branching on `ApiError.code` for the codes `/api/photos/analyze` actually emits:
  - `LIMIT_REACHED`: daily scan limit copy. Check whether the app has an existing upgrade/limit message or paywall entry to reuse.
  - `RATE_LIMITED`: from `photoRateLimit`.
  - `IMAGE_TOO_LARGE`.
  - Everything else, including the network `TypeError`, the plain `Error("Not authenticated")` and "Invalid response from server": generic retry copy.
- [x] Error haptic, the abort/`isAbortError` early return and the existing retry flow are unchanged.
- [x] Tests:
  - A thrown error with an internal message is not rendered.
  - `LIMIT_REACHED` shows the limit copy.
  - Positive control: the test fails against the current `err.message` code.

## Implementation Notes

- File: `client/hooks/usePhotoAnalysis.ts`, analyze effect `catch` (~L172).
- Re-read the route's codes before writing copy: `server/routes/photos.ts` `/api/photos/analyze` (~L164 onward, `sendError(...)` calls) and `checkAiConfigured`.
- Reference mapping: `handleLogSelected`'s catch in the same file (after #1284 merges) and `LabelAnalysisScreen`'s `confirmLog.onError`.
- Check other `uploadPhotoForAnalysis` / `uploadError` callers for the same `err.message` pattern before closing. Sweep by the symbol, not the wording.

## Resolution (2026-10-06)

- **Fix:** `analysisErrorMessage(err)` in `usePhotoAnalysis.ts` maps `LIMIT_REACHED`, `RATE_LIMITED`, `IMAGE_TOO_LARGE` and `SESSION_LIMIT_REACHED`/`USER_SESSION_LIMIT` to static copy. Everything else, including `AI_NOT_CONFIGURED` and `VALIDATION_ERROR`, falls through to the generic retry copy.
- **Daily-limit copy:** it mentions upgrading but doesn't open the paywall. The scan flow already counts scans before upload, so this is a fallback.
- **Sweep by symbol:** checked every caller of `uploadPhotoForAnalysis`, `uploadLabelForAnalysis` and `submitFollowUp`.
  - `ScanScreen` passes `err.message` into `CLASSIFICATION_FAILED`, but the reducer and chip never render `phase.error`; the chip uses fixed `smart_error` copy. Not a leak.
  - `LabelAnalysisScreen` already maps codes.
  - The `submitFollowUp` catch shows nothing.
