---
title: FlatList's ListEmptyComponent keeps rendering its own actions while a sibling UI toggle already replaced them
track: bug
category: logic-errors
module: client
severity: low
tags: [flatlist, listemptycomponent, empty-state, duplicate-control, react-native]
symptoms: ['An action button inside `ListEmptyComponent` stays visible after tapping it once switches a sibling section (e.g. a footer) into an input/form view', 'Tapping the empty-state button again is a silent no-op', 'The bug is invisible in the "list has items" case — only reproduces when the list is empty AND a local state flag has changed the surrounding UI']
applies_to: [client/components/**/*.tsx, client/screens/**/*.tsx]
created: '2026-07-14'
---

# FlatList's ListEmptyComponent keeps rendering its own actions while a sibling UI toggle already replaced them

## Problem

`CookbookPickerModal.tsx`'s empty state (rendered via `FlatList`'s
`ListEmptyComponent`) offered a "New Cookbook" primary action and a "Save to
Favourites" secondary action. Tapping "New Cookbook" sets local state
(`showNewInput = true`), which swaps a separate footer `View` from a plain
button into an inline cookbook-name `TextInput` + "Create" button. But
`ListEmptyComponent` renders whenever `data` is empty — full stop, regardless
of `showNewInput` — so the original "New Cookbook" and "Save to Favourites"
buttons stayed visible above the newly-opened input row. Tapping either
button again did nothing useful (re-setting already-true state, or
re-favouriting an already-favourited recipe), and the UI looked cluttered and
half-finished.

## Symptoms

- A `FlatList`'s `ListEmptyComponent` contains one or more action buttons
- Tapping one of those buttons flips a **local state flag** that changes a
  **different, sibling** part of the render tree (a footer, a form, another
  section) — but does *not* change whether `data` is empty
- After the tap, the empty-state buttons are still on screen, now sitting
  above/beside the UI they were supposed to hand off to

## Root Cause

`ListEmptyComponent`'s visibility is derived from one thing only: whether
`data` is empty. It has no automatic awareness of any other local component
state. A button placed inside it can trigger a state change elsewhere in the
component, but nothing hides the button itself unless the empty-state JSX is
*also* explicitly conditioned on that same state.

## Solution

Gate each `ListEmptyComponent` action (and any secondary action) on the same
flag that drives the sibling swap, so the two surfaces never show
overlapping controls at once:

```tsx
<EmptyState
  variant="firstTime"
  icon="book"
  title="No cookbooks yet"
  description="…"
  actionLabel={showNewInput ? undefined : "New Cookbook"}
  onAction={showNewInput ? undefined : handleShowNewInput}
  secondaryLabel={showNewInput || isFavourited ? undefined : "Save to Favourites"}
  onSecondaryAction={showNewInput || isFavourited ? undefined : handleSaveToFavourites}
/>
```

A component-level render test (not a pure-function extraction — see
[Pure-utils extraction tests don't prove wiring](../conventions/pure-utils-extraction-tests-dont-prove-wiring-2026-07-14.md))
that clicks the empty-state action and asserts the empty-state controls are
gone catches this directly; a test that only checks each button's `onPress`
callback in isolation would miss it.

## Prevention

- Whenever a `ListEmptyComponent` contains an action that toggles local
  state, ask: does any *other* part of this render tree also depend on that
  same state? If yes, the empty-state JSX must condition on it too.
- Prefer writing the "after tapping the empty-state action" case as an
  explicit test case, not just "empty state renders" and "sibling section
  toggles" as two separate, disconnected tests — the bug only shows up in
  their intersection.

## Related Files

- `client/components/CookbookPickerModal.tsx` — `ListEmptyComponent`
  (fixed), `showNewInput` (the flag both surfaces must share)

## See Also

- [Use extraData (not useCallback deps) for FlatList re-renders driven by ref-based state](../conventions/flatlist-extradata-for-ref-based-state-2026-06-03.md)
