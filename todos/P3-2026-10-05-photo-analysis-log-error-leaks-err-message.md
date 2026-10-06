---
title: "Photo-analysis log failure shows raw err.message in the UI"
status: backlog
priority: low
created: 2026-10-05
updated: 2026-10-05
assignee:
labels: [deferred, client]
github_issue:
---

# Photo-analysis log failure shows raw err.message in the UI

## Summary

`handleLogSelected` in `client/hooks/usePhotoAnalysis.ts` (~L332) feeds `err.message` straight into `setError`, which renders it via `InlineError`. Raw server/network error text can reach the user, violating the `no-error-message-in-ui` rule.

## Background

Surfaced by the 2026-10-05 interaction-feel audit (scan → log slice). Out of scope for that read-only audit; not a feel issue but a rules violation on the core log path.

## Acceptance Criteria

- [ ] The catch branch maps the error to a user-safe message (follow how `useNutritionLookup`'s `onError` maps `ApiError.code`) instead of showing `err.message`
- [ ] Error haptic and `InlineError` behaviour unchanged; draft selection preserved
- [ ] Test covers a thrown error with an internal message and asserts it is not rendered

## Implementation Notes

- File: `client/hooks/usePhotoAnalysis.ts` (`handleLogSelected` catch block)
- Reference mapping: `client/hooks/useNutritionLookup.ts` `addToLogMutation.onError`
- If the log-success interaction work touches `handleLogSelected`, fold this fix into that PR.
