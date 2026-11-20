---
title: "Simple Entry: a late add reply can land in a reopened sheet"
status: done
priority: low
created: 2026-11-19
updated: 2026-11-19
assignee:
labels: [deferred, client]
github_issue:
---

# Simple Entry: a late add reply can land in a reopened sheet

## Summary

`SimpleEntrySheet` drops an estimate or drink/side reply that arrives after the sheet was closed and reopened, but not the reply to **Add**. Give `handleAdd` the same protection.

## Background

PR #1945 added a session counter (`sessionRef`) to `client/components/meal-plan/SimpleEntrySheet.tsx`. It is bumped whenever the sheet opens or closes, and `handleEstimate` and `handleAddExtra` compare it after their `await` so a reply for an earlier opening is ignored.

`handleAdd` was left out. If the person taps Add, closes the sheet while the request is in flight and reopens it for another meal:

- a failed add calls `showError`, so the new opening shows "Couldn't add it to your plan" for an entry it never saw;
- the `finally` runs `isBusyRef.current = false` and `setIsAdding(false)`, which can release the busy guard under an estimate the new opening has started;
- a successful add calls `onDismiss()`, which closes the sheet the person has just reopened.

The mobile reviewer raised this on the final confirmation pass of #1945 (2026-11-19). It was deferred because the old one-step sheet behaved the same way, it needs an unusual sequence, and a fix at that point would have voided the review record for the PR.

## Acceptance Criteria

- [x] `handleAdd` captures the session before its first `await` and, when the session has changed, skips `showError`, `setShowUpgrade`, the busy and `isAdding` resets, and `onDismiss()`.
- [x] A successful late add still invalidates the meal-plan items query and still shows the success toast, because the entry was saved.
- [x] A test in `client/components/meal-plan/__tests__/SimpleEntrySheet.test.tsx` holds the add request open, closes and reopens the sheet, rejects the request, and asserts the new opening shows no error and its Estimate button is usable.
- [x] A second test resolves the held request instead and asserts the reopened sheet is not dismissed.

## Implementation Notes

Follow the pattern already in `handleEstimate`: `const session = sessionRef.current;` before the request, `if (session !== sessionRef.current) return;` after each `await` that leads to a state change, and the same check around the `finally` resets. The existing test "drops an estimate that arrives after the sheet was closed and reopened" shows how to hold a request open and reopen the sheet.

Decide the saved-but-closed case deliberately: the recipe and plan item exist, so the toast is still true, but dismissing the new opening is wrong.

## Scope Contract

- **Mechanisms to use:** the existing `sessionRef` counter in `SimpleEntrySheet.tsx` — nothing new.
- **Files in scope:** `client/components/meal-plan/SimpleEntrySheet.tsx`, `client/components/meal-plan/__tests__/SimpleEntrySheet.test.tsx`
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- PR #1945 must be merged first; the session counter does not exist on `main` before it.

## Risks

- Client-only change: it reaches phones through an OTA, published only when the owner asks.

## Updates

### 2026-11-19

- Initial creation, from the mobile reviewer's note on PR #1945.

### 2026-11-19 (done)

- `handleAdd` now compares the session after its requests. A late reply still refreshes the plan and shows the toast when the entry was saved, but leaves the new opening's error, busy state and visibility alone. Two tests added.
