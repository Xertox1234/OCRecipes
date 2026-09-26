---
title: "Quick Log: pressing the keyboard's search key logs nothing and shows nothing — fix submit, results visibility, and the empty result"
status: backlog
priority: medium
created: 2026-09-26
updated: 2026-09-26
assignee:
labels: [react-native, ux, quick-log]
github_issue:
---

# Quick Log: pressing the keyboard's search key logs nothing and shows nothing — fix submit, results visibility, and the empty result

## Summary

On device (2026-09-26, premium account, preview update `7b87c557`), the user typed a meal into
the Home Quick Log drawer and pressed the keyboard's blue **search** key. They felt a haptic,
but saw nothing, and nothing was logged. The Profile counter stayed at "0 of 2000". Make the
submit obvious, make the result always visible, and handle an empty parse, so typing a meal
always ends in either a visible list with **Log All** or a visible message.

## Background

User's words: "The keyboard shows a blue search icon, no enter button... After entering my meal
to be logged I pressed the search button... nothing else happened other than a small haptic. I
then visited my profile to discover nothing has been logged because the counter says 0 of 2000."

Facts from the code (verified 2026-09-26):

- **Search key:** `client/components/home/QuickLogDrawer.tsx` sets `returnKeyType="search"`, and
  `client/screens/QuickLogScreen.tsx` does the same. Neither has an on-screen submit button;
  the keyboard key is the only way to parse.
- **Haptic:** it proves nothing. `handleTextSubmit` in `client/hooks/useQuickLogSession.ts`
  fires `haptics.impact(Medium)` before the request, so a hang, a failure or an empty result
  all feel the same.
- **Two steps:** logging is parse, then an explicit **Log All**. Parsed items render under the
  input with a total and a **Log All** button (`QuickLogDrawer.tsx`, the `hasParsedItems`
  block). Nothing is logged until that tap, which is why the counter stayed at 0.
- **No scroll-into-view:** the Home drawer never scrolls its results into view. `HomeScreen`'s
  `glideRowToTop` works only for rows wrapped in a `drawerRowRefs` ref, and
  `renderInlineAction` returns `<QuickLogDrawer>` directly, with no ref and no glide. With the
  keyboard up, or the drawer low on the page, results can land off-screen.
- **Empty parse:** `server/services/food-nlp.ts` can return `items: []` on a successful parse.
  The drawer then shows nothing: the chips hide only when there are items, and no "no food
  found" message exists.

Cause not yet pinned down. It is one of these:

1. results rendered but were off-screen or under the keyboard;
2. an empty parse (`items: []`);
3. the request hung or failed without a visible error.

## Acceptance Criteria

- [ ] **Reproduce first** on the simulator against a local server: open Home Quick Log, type a
      realistic meal (e.g. "2 eggs and toast"), press the return key. Record which of causes
      1–3 happened, with evidence (screenshot or network log), in this todo's Updates. Check
      the API IP first (`curl $EXPO_PUBLIC_DOMAIN/api/health`).
- [ ] **Return key:** both the drawer and `QuickLogScreen` use a return key that reads as
      submitting (`returnKeyType="done"` or `"go"`), not `"search"`.
- [ ] **Visible submit:** there is an on-screen submit control next to the input (44pt target,
      labelled for VoiceOver), disabled while the input is empty or a parse is running.
- [ ] **Parse status:** a visible parsing indicator shows while the request is in flight.
- [ ] **Empty parse:** shows an inline message such as "Couldn't find any food in that — try
      '2 eggs and toast'", announced for VoiceOver.
- [ ] **Scroll into view:** after a successful parse, the results and **Log All** are scrolled
      into view on Home, with the keyboard dismissed or the list kept above it.
- [ ] **Tests:** co-located tests cover the return key, a disabled/enabled submit button, the
      empty-parse message, and the parsing indicator.

## Implementation Notes

- **Scrolling:** reuse Home's existing glide (`glideRowToTop`, `drawerRowRefs`, `measure` /
  `scrollTo` in `client/screens/HomeScreen.tsx`) by wrapping `<QuickLogDrawer>` in the same
  `Animated.View ref` the other inline drawers get. Fire it when parsed items first appear,
  not on open.
- **Empty state:** belongs in `useQuickLogSession.ts`, e.g. a `parseEmpty` flag set when
  `data.items.length === 0`. Keep it separate from `parseError`: an empty result is not a
  failure.
- **Keyboard:** `Keyboard.dismiss()` on submit is the simplest way to keep results visible.
- **Out of scope:** the free-tier lock (P2 `quick-log-locked-for-free-tier`). Don't touch
  its premium gating.
- If reproduction shows cause 3 (a hang), investigate the parse route's latency and timeout
  before adding UI.

## Scope Contract

- **Mechanisms to use:** existing `returnKeyType`, Home's `glideRowToTop` + `drawerRowRefs`,
  `InlineError`-style inline messaging, `useQuickLogSession` state. Nothing new.
- **Files in scope:**
  - `client/components/home/QuickLogDrawer.tsx`
  - `client/screens/QuickLogScreen.tsx`
  - `client/hooks/useQuickLogSession.ts`
  - `client/screens/HomeScreen.tsx`
  - their co-located `__tests__/`
  - `server/services/food-nlp.ts` / `server/routes/food.ts`, only if reproduction shows a
    server-side cause
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None. Coordinate with `quick-log-locked-for-free-tier` if both run together: they share
  `QuickLogDrawer.tsx`, `QuickLogScreen.tsx` and `HomeScreen.tsx`.

## Risks

- Scrolling while the keyboard animates can fight the ScrollView. Dismiss the keyboard first,
  then glide.
- The real cause is unconfirmed. Don't ship UI-only changes if reproduction shows the parse
  itself failing or hanging.

## Updates

### 2026-09-26

- Created from the user's on-device report. They approved filing it ("sounds good").
