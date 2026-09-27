---
title: "Quick Log is offered to free-tier users but the server refuses them — lock, grey out, or hide it"
status: done
priority: medium
created: 2026-09-26
updated: 2026-09-26
assignee:
labels: [premium, react-native, ux]
github_issue:
---

# Quick Log is offered to free-tier users but the server refuses them — lock, grey out, or hide it

## Summary

Free-tier users can open Quick Log and type or dictate food, but every parse fails.
Both typed and dictated text go to `POST /api/food/parse-text`, which requires the premium
feature `textFoodParsing` (`false` for the free tier). Dictation is transcribed on-device first.
The entry points should show Quick Log as a premium feature, or not offer it at all.

## Background

The user hit this on device on 2026-09-26: their account was on the free tier, and Quick Log showed
"Failed to parse food text. Please try again." That message was misleading. A separate fix
(#1113, merged 2026-09-26) makes the error honest ("Quick Log is a premium
feature…"). Showing an error only after the user has typed a meal is still the wrong
experience. User direction: "If the user does not have access then it should either be locked,
greyed out or just not visible."

Entry points found:

- **Home inline drawer:** `client/screens/HomeScreen.tsx` `renderInlineAction` special-cases
  `quick-log` and renders `<QuickLogDrawer>` directly. That skips the `isLocked` path every other
  inline action gets, and the `quick-log` entry in `client/components/home/action-config.ts` has
  no `premium: true`.
- **Coach navigation:** `client/components/coach/CoachChat.tsx` (`case "QuickLog"`) opens the
  `QuickLog` root modal (`client/screens/QuickLogScreen.tsx`,
  `client/navigation/RootStackNavigator.tsx`).
- **Voice:** `client/hooks/useQuickLogSession.ts`'s voice auto-parse transcribes on-device
  (`useSpeechToText`), then calls the same `parse-text` mutation. It shares the
  `textFoodParsing` gate. `/api/food/transcribe` (`voiceLogging`) has no client caller and is
  not part of this bug.
- **Existing partial gate:** `client/screens/QuickLogScreen.tsx` already hides
  `<VoiceLogButton>` behind the expiry-aware `usePremiumContext().isPremium`, while leaving the
  text input and Parse button ungated. Build the screen guard on that; don't duplicate it.

## Acceptance Criteria

- [x] **Free tier, Home:** the Quick Log row shows the existing locked treatment (lock icon /
      `isLocked` on `HomeInlineDrawer`, as the other premium inline actions do). Tapping it opens
      the existing upgrade flow and does not open the text input.
- [x] **Free tier, other paths:** Coach-initiated navigation and a direct `QuickLog` modal open
      show the upgrade flow instead of a working-looking input. Enforce this with a screen-level
      guard in `QuickLogScreen`, not only at the entry points.
- [x] **Premium tier:** unchanged behavior (control test).
- [x] **Gate source:** gates read `usePremiumFeature("textFoodParsing")`
      (`client/hooks/usePremiumFeatures.ts`), which is expiry-aware. Do not compare the raw
      `user.subscriptionTier === "premium"` as `HomeScreen` does today: a lapsed subscriber
      would see an unlocked row the server refuses.
- [x] **VoiceOver:** the locked row announces "Quick Log, premium feature" (match the
      `PhotoIntentScreen` locked-option wording).
- [x] **Tests:** co-located tests cover the free, premium and lapsed-premium cells for the Home
      row and the screen guard.

## Implementation Notes

Reuse, don't invent:

- `HomeInlineDrawer`'s `isLocked` prop and the lock branch in `HomeScreen`'s
  `handleDrawerToggle` (`action.premium && !isPremium` → upgrade).
- `PhotoIntentScreen`'s locked-option accessibility wording.

**DECIDED (user, 2026-09-26): locked.** Quick Log stays visible with a lock and routes to the
upgrade flow. It is not hidden, and there is no free daily quota. Apply this everywhere.

## Scope Contract

- **Mechanisms to use:** the existing `premium` flag on `HomeAction`, the `isLocked` shell prop,
  `usePremiumFeature`, and the existing upgrade modal/screen. Nothing new.
- **Files in scope:**
  - `client/components/home/action-config.ts`
  - `client/screens/HomeScreen.tsx`
  - `client/components/home/QuickLogDrawer.tsx`
  - `client/screens/QuickLogScreen.tsx`
  - `client/components/coach/CoachChat.tsx`
  - their co-located `__tests__/`
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None. The honest-error fix (#1113) is already merged; `useQuickLogSession.ts` stays out of
  this todo's scope.

## Risks

- **Contradictory feature matrix:** the free tier lists `dailyNlpLogs: 5` in
  `shared/types/premium.ts`, but `textFoodParsing: false`, and no server code reads
  `dailyNlpLogs`. The user chose a lock over a free daily quota (2026-09-26), so
  `dailyNlpLogs` stays unused. Removing the dead field is out of scope here.
- `HomeScreen`'s raw-tier `isPremium` is also used for the other premium rows. Switching only
  Quick Log to `usePremiumFeature` leaves the rows inconsistent for lapsed subscribers. Note
  it; don't widen scope.

## Updates

### 2026-09-26

- Created from the user's on-device report and their direction on locking.
- User decided: **lock** (not hide, not a 5-a-day free quota). The human-led gate is removed.
- Done in one branch with `quick-log-submit-and-results-ux` (user approved). Home locks the
  row on `usePremiumFeature("textFoodParsing")`, unlocked until the subscription loads (the
  server still gates). `QuickLogScreen` gates itself, so Coach, recent actions and deep
  links get the upgrade flow; `CoachChat.tsx` needed no change. The locked-row label is set
  in `HomeInlineDrawer` (outside the listed files), which also fixes Generate Recipe's
  locked row. Simulator: free demo account shows the lock, announces "Quick Log, premium
  feature", and a tap opens the upgrade modal.
