<!-- Filename: P3-2026-07-13-toast-dismiss-on-retry.md -->

---

title: "Expose a Toast dismiss API and clear stale toasts when a retry action fires"
status: done
priority: low
created: 2026-07-13
updated: 2026-07-13
assignee:
labels: [deferred, react-native]
github_issue:

---

# Expose a Toast dismiss API and clear stale toasts when a retry action fires

## Summary

`ToastContextType` has no `dismiss` method exposed to consumers. `LabelAnalysisScreen`'s `retryUpload` (shared by both the failure toast's "Retry" action and the on-screen "Retry Analysis"/"Retry Verification" button) doesn't dismiss any currently-visible toast, so retrying via the on-screen button while the original failure toast is still showing leaves a stale "Couldn't verify..." message on screen while the new attempt is already in flight.

## Background

Flagged by mobile-reviewer during the PR #617 code review. Low-severity UX rough edge — the toast auto-dismisses on its own timer regardless.

## Acceptance Criteria

- [ ] `ToastContextType` (`client/context/ToastContext.tsx`) exposes a `dismiss()` method
- [ ] `LabelAnalysisScreen.tsx`'s `retryUpload` calls it before re-triggering the upload

## Implementation Notes

- `ToastContext.tsx` already has an internal `dismiss` callback (used for auto-dismiss/swipe) — just needs adding to the exported `ToastContextType`/`value` memo
- Check other call sites don't rely on the toast persisting past a retry-style action before widening the public API

## Dependencies

- None

## Risks

- None significant — additive API surface

## Updates

### 2026-07-13

- Filed from PR #617 mobile-reviewer finding
