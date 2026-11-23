---
title: "Label screen: photo re-uploads on Reduce Motion toggle; rate-limit toast says retry"
status: backlog
priority: low
created: 2026-11-23
updated: 2026-11-23
assignee:
labels: [client, camera]
github_issue:
---

# Label screen: photo re-uploads on Reduce Motion toggle; rate-limit toast says retry

## Summary

Three small problems on the label analysis screen that `/code-review` found on PR #1990. All
three were already on `main` before that refactor, so they were left out of it.

## Background

- **Re-upload when Reduce Motion is toggled.** The upload effect in
  `client/hooks/useLabelAnalysisSession.ts` depends on `toast` and `retry`. `toast` changes
  identity when `reducedMotion` changes (`useHaptics().notification` → `ToastContext.error` →
  the context value). Toggling Reduce Motion while the screen is open uploads the photo again:
  a second AI call and a new session. PR #1990 made the second run harmless to what is shown,
  but it still happens.
- **Rate-limit copy.** When the upload answers `RATE_LIMITED` and a local preview exists, the
  hook computes "Too many requests. Please wait a moment…" but the reducer drops the message,
  and the toast always says "Couldn't verify this label with AI. Retry before logging." The
  Retry button then hits the limiter again.
- **"1 servings".** The stepper value in `client/components/LabelServingsCard.tsx` has
  `accessibilityLabel` `${servings} servings` with no singular form. Not verified on a device.

## Acceptance Criteria

- [ ] Toggling Reduce Motion on the label screen does not upload the photo again (read
      `toast` through a ref, or depend only on `imageUri`, `barcode` and `retryToken`).
- [ ] A rate-limited upload with a local preview tells the user to wait, not to retry.
- [ ] The stepper value reads "1 serving" at 1.
- [ ] Each has a Vitest case.

## Implementation Notes

React Compiler covers the hook: no `try`/`finally` and no `throw` inside a `try` block
(`node scripts/check-react-compiler-bailouts.js`).

## Scope Contract

- **Mechanisms to use:** the existing hook, reducer and toast; nothing new.
- **Files in scope:** `client/hooks/useLabelAnalysisSession.ts`,
  `client/screens/label-analysis-utils.ts`, `client/components/LabelServingsCard.tsx`, and
  their test files.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- PR #1990 merged.
