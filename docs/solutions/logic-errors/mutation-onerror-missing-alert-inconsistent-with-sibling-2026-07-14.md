---
title: New mutation call site silently drops the user-facing alert a sibling call site already shows
track: bug
category: logic-errors
module: client
severity: medium
tags: [tanstack-query, mutations, error-handling, alert, ui-consistency]
symptoms: ['A new `mutate(vars, { onError })` handler only plays a haptic/notification on failure, with no `Alert.alert` or visible message', 'A sibling mutation call in the SAME component already shows `Alert.alert` on its own `onError`', 'User taps an action, it silently fails, and nothing on screen explains why']
applies_to: [client/components/**/*.tsx, client/screens/**/*.tsx]
created: '2026-07-14'
---

# New mutation call site silently drops the user-facing alert a sibling call site already shows

## Problem

`CookbookPickerModal.tsx` had `handleAddToCookbook`'s `onError` correctly show
`Alert.alert("Error", "Failed to add recipe. Please try again.")` (with a
special-cased `Alert.alert("Already Saved", ...)` for a `CONFLICT` code). When
a new sibling action (`handleSaveToFavourites`, wired to
`useToggleFavouriteRecipe`) was added to the same modal, its `onError` was
written as haptic-feedback-only:

```typescript
onError: () => {
  haptics.notification(Haptics.NotificationFeedbackType.Error);
},
```

A generic failure (network error, 500, etc.) left the user with an error
buzz and zero explanation — the modal stayed open with no visible feedback,
while the pre-existing sibling action in the exact same file always alerts on
failure.

## Symptoms

- New mutation handler compiles clean, passes the happy-path test, ships
- A code review pass (even a low-effort diff-only pass) flags the asymmetry:
  "this onError doesn't match its sibling's error handling"
- Bug only reproduces on an actual failure (network drop, server 500) — the
  happy path and most manual QA never exercise it

## Root Cause

Copy-adjacent code (a new handler modeled loosely on an existing one) is easy
to under-copy: the haptic call gets carried over, the `Alert.alert` does not,
because it reads like "just feedback," not "the actual user-facing contract."
When a component already has an established error-surfacing convention (every
mutate call site alerts on failure), a new call site that only omits the alert
introduces silent, inconsistent failure handling — worse than having no
convention at all, because now some actions in the same screen fail loudly and
others fail invisibly.

## Solution

Mirror the sibling's alert, adjusting only for handler-specific error codes
that already have their own dedicated alert upstream (don't double-alert):

```typescript
onError: (err) => {
  haptics.notification(Haptics.NotificationFeedbackType.Error);
  // useToggleFavouriteRecipe already alerts for LIMIT_REACHED itself —
  // avoid showing a second, redundant alert for that case.
  if (!(err instanceof ApiError && err.code === ErrorCode.LIMIT_REACHED)) {
    Alert.alert("Error", "Failed to save recipe. Please try again.");
  }
},
```

## Prevention

- When adding a new `mutate(...)` call site to a component that already has
  one or more mutation call sites, grep the file for `onError:` first and
  match the existing alert convention — don't just copy the haptic call.
- A hook's own internal `onError` (defined inside `useMutation({...})`) and a
  per-call `onError` (passed to `mutate(vars, { onError })`) both fire on
  failure — check whether the hook already alerts for a specific error code
  before adding a second alert for that same code at the call site.
- Low-effort diff-only code review (`/code-review low`) catches this class of
  finding well: the sibling call site is visible in the same hunk/file, so
  the asymmetry doesn't require any extra context to spot.

## Related Files

- `client/components/CookbookPickerModal.tsx` — `handleSaveToFavourites`
  (fixed), `handleAddToCookbook` (the sibling pattern it now matches)

## See Also

- [Mutation onError Missing cancelled Guard After Unmount](mutate-onerror-missing-cancelled-guard-2026-05-13.md)
