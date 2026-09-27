---
title: "Quick Log: pressing the keyboard's search key logs nothing and shows nothing — fix submit, results visibility, and the empty result"
status: done
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

- **Search key:** `client/components/home/QuickLogDrawer.tsx` sets `returnKeyType="search"` and
  has no on-screen submit button or parsing indicator; the keyboard key is the only way to
  parse there. `client/screens/QuickLogScreen.tsx` also sets `"search"`, but it already has a
  44pt "Parse" button with a spinner (`:183-218`). Its input is `multiline`, and RN 0.81's
  `TextInput` defaults a multiline input to `submitBehavior="newline"`, so that screen's return
  key inserts a newline and never submits, whatever `returnKeyType` says.
- **Haptics:** `handleTextSubmit` in `client/hooks/useQuickLogSession.ts` fires
  `haptics.impact(Medium)` before the request, then a Success or Error notification haptic when
  it settles. Success (including an empty result) and failure feel different; only a request
  that has not settled yet leaves the single impact the user described.
- **Two steps:** logging is parse, then an explicit **Log All**. Parsed items render under the
  input with a total and a **Log All** button (`QuickLogDrawer.tsx`, the `hasParsedItems`
  block). Nothing is logged until that tap, which is why the counter stayed at 0.
- **No scroll-into-view:** the Home drawer never scrolls its results into view. `HomeScreen`'s
  `glideRowToTop` works only for rows wrapped in a `drawerRowRefs` ref, and
  `renderInlineAction` returns `<QuickLogDrawer>` directly, with no ref and no glide. With the
  keyboard up, or the drawer low on the page, results can land off-screen.
- **Empty parse:** `server/services/food-nlp.ts` can return `items: []` on a successful parse.
  The drawer then looks unchanged: the frequent-item chips come back (they render whenever
  there are no parsed items), and no "no food found" message exists.

Cause not yet pinned down. It is one of these:

1. results rendered but were off-screen or under the keyboard;
2. an empty parse (`items: []`);
3. the request hung or failed without a visible error.

## Acceptance Criteria

- [x] **Reproduce first** on the simulator against a local server: open Home Quick Log, type a
      realistic meal (e.g. "2 eggs and toast"), press the return key. Record which of causes
      1–3 happened, with evidence (screenshot or network log), in this todo's Updates. Check
      the API IP first (`curl $EXPO_PUBLIC_DOMAIN/api/health`).
- [x] **Return key:** both the drawer and `QuickLogScreen` use a return key that reads as
      submitting (`returnKeyType="done"` or `"go"`), not `"search"`. On `QuickLogScreen` the
      key must actually submit: set `submitBehavior="submit"` on its multiline input.
- [x] **Visible submit (drawer):** the drawer gets an on-screen submit control next to the
      input (44pt target, labelled for VoiceOver), disabled while the input is empty or a parse
      is running. `QuickLogScreen` already has one; don't add a second.
- [x] **Parse status (drawer):** a visible parsing indicator shows while the request is in
      flight. `QuickLogScreen`'s Parse button already shows a spinner.
- [x] **Empty parse:** shows an inline message such as "Couldn't find any food in that — try
      '2 eggs and toast'", announced for VoiceOver.
- [x] **Scroll into view:** after a successful parse, the results and **Log All** are scrolled
      into view on Home, with the keyboard dismissed or the list kept above it.
- [x] **Tests:** co-located tests cover the return key, a disabled/enabled submit button, the
      empty-parse message, the parsing indicator, and that the drawer calls its
      results-shown callback once when items first appear. The glide itself (`measure` /
      `scrollTo` worklets) is verified on the simulator, not in Vitest — a deliberate omission.

## Implementation Notes

- **Scrolling:** reuse Home's existing glide (`glideRowToTop`, `drawerRowRefs`, `measure` /
  `scrollTo` in `client/screens/HomeScreen.tsx`) by wrapping `<QuickLogDrawer>` in the same
  `Animated.View ref` the other inline drawers get. Fire it when parsed items first appear,
  not only on open. Today `QuickLogDrawer` owns `isOpen` locally (`:131`) and never passes
  through Home's `openDrawerId` / `handleDrawerToggle`, the only caller of `glideRowToTop`.
  So make the drawer controlled: Home passes `isOpen`, `onToggle` and `isLocked`, like the
  generic branch of `renderInlineAction`, plus a results-shown callback that calls
  `glideRowToTop("quick-log")`.
- **Empty state:** belongs in `useQuickLogSession.ts`, e.g. a `parseEmpty` flag set when
  `data.items.length === 0`. Keep it separate from `parseError`: an empty result is not a
  failure.
- **Keyboard:** the drawer's input is single-line, so RN's default `blurAndSubmit` already
  dismisses the keyboard on the return key. The new submit button must dismiss it too
  (`Keyboard.dismiss()`).
- **Out of scope:** the free-tier lock (P2 `quick-log-locked-for-free-tier`). Don't touch
  its premium gating.
- If reproduction shows cause 3 (a hang), investigate the parse route's latency and timeout
  before adding UI.

## Scope Contract

- **Mechanisms to use:** existing `returnKeyType` / `submitBehavior`, Home's `glideRowToTop` +
  `drawerRowRefs`, `InlineError`-style inline messaging, `useQuickLogSession` state.
- **Pre-authorized:** making `QuickLogDrawer` controlled by `HomeScreen` (`isOpen`, `onToggle`,
  `isLocked` props, a `quick-log` entry in `drawerRowRefs`), and one results-shown callback
  prop from the drawer up to Home to trigger the glide.
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

- None. Coordinate with `quick-log-locked-for-free-tier`: both restructure the same code,
  the `quick-log` special case at the top of `HomeScreen`'s `renderInlineAction` (this todo
  wraps it in a glide ref; that one routes it through `isLocked` / `handleDrawerToggle`).
  The user approved doing both in one branch (2026-09-26), which removes the merge-order risk.

## Risks

- Scrolling while the keyboard animates can fight the ScrollView. Dismiss the keyboard first,
  then glide.
- The real cause is unconfirmed. Don't ship UI-only changes if reproduction shows the parse
  itself failing or hanging.

## Updates

### 2026-09-26

- Created from the user's on-device report. They approved filing it ("sounds good").
- Simulator run (iPhone 17 sim, local server, demo premium account): typed "2 eggs and
  toast" in the Home drawer and pressed return. The server logged `POST
/api/food/parse-text` 200 in 1866 ms; the two items and **Log All** rendered about 2 s
  later, on screen, because the drawer sat high on the page. So none of causes 1–3
  reproduced on the simulator; the device failure is not reproduced. The single haptic
  suggests the request had not settled while the user watched (a hypothesis, not a
  measurement); prod logs for `parse-text` at the time of the attempt would tell.
- Done in one branch with `quick-log-locked-for-free-tier`. The drawer is controlled by
  Home and glides into view when items first appear; it has a "Find food" button with a
  spinner, a "done" return key, and an empty-parse message (`parseEmpty`). `QuickLogScreen`
  submits on return with `submitBehavior="blurAndSubmit"` (blur, as the drawer does) and
  toasts the empty-parse message. Vitest asserts the `returnKeyType` / `submitBehavior`
  values only: the RN mock drops `onSubmitEditing`, so the key press itself was checked on
  the simulator (return submitted; items and Log All glided on screen).
- Seen on the simulator, not fixed here (filed separately): while typing, the keyboard
  covers the drawer's input on a short Home page, because Home has no keyboard avoidance
  and the glide cannot scroll past the content's end.
