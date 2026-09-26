---
title: "Quick Log is offered to free-tier users but the server refuses them — lock, grey out, or hide it"
status: backlog
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
`POST /api/food/parse-text` requires the premium feature `textFoodParsing`, and voice
(`/api/food/transcribe`) requires `voiceLogging`. Both are `false` for the free tier.
The entry points should show Quick Log as a premium feature, or not offer it at all.

## Background

The user hit this on device on 2026-09-26: their account was on the free tier, and Quick Log showed
"Failed to parse food text. Please try again." That message was misleading. A separate fix
(branch `fix/quicklog-premium-error-2026-09-26`) makes the error honest ("Quick Log is a premium
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
- **Voice:** `client/hooks/useQuickLogSession.ts` (voice auto-parse, `voiceLogging`).

## Acceptance Criteria

- [ ] **Free tier, Home:** the Quick Log row shows the existing locked treatment (lock icon /
      `isLocked` on `HomeInlineDrawer`, as the other premium inline actions do). Tapping it opens
      the existing upgrade flow and does not open the text input.
- [ ] **Free tier, other paths:** Coach-initiated navigation and a direct `QuickLog` modal open
      show the upgrade flow instead of a working-looking input. Enforce this with a screen-level
      guard in `QuickLogScreen`, not only at the entry points.
- [ ] **Premium tier:** unchanged behavior (control test).
- [ ] **Gate source:** gates read `usePremiumFeature("textFoodParsing")`
      (`client/hooks/usePremiumFeatures.ts`), which is expiry-aware. Do not compare the raw
      `user.subscriptionTier === "premium"` as `HomeScreen` does today: a lapsed subscriber
      would see an unlocked row the server refuses.
- [ ] **VoiceOver:** the locked row announces "Quick Log, premium feature" (match the
      `PhotoIntentScreen` locked-option wording).
- [ ] **Tests:** co-located tests cover the free, premium and lapsed-premium cells for the Home
      row and the screen guard.

## Implementation Notes

Reuse, don't invent:

- `HomeInlineDrawer`'s `isLocked` prop and the lock branch in `HomeScreen`'s
  `handleDrawerToggle` (`action.premium && !isPremium` → upgrade).
- `PhotoIntentScreen`'s locked-option accessibility wording.

Decide between locked and hidden once, and apply it everywhere. The recommended default is
**locked** (visible with a lock and routing to upgrade). It matches the other premium Home
actions and advertises the feature.

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

- Lands cleanly after `fix/quicklog-premium-error-2026-09-26` (it touches
  `useQuickLogSession.ts`, which is out of this todo's scope).

## Risks

- **Contradictory feature matrix:** the free tier lists `dailyNlpLogs: 5` in
  `shared/types/premium.ts`, but `textFoodParsing: false`, and no server code reads
  `dailyNlpLogs`. If the product intent was "free users get 5 Quick Logs a day", the fix is a
  server quota, not a lock. Confirm with the user before implementing; the current direction
  is lock/hide.
- `HomeScreen`'s raw-tier `isPremium` is also used for the other premium rows. Switching only
  Quick Log to `usePremiumFeature` leaves the rows inconsistent for lapsed subscribers. Note
  it; don't widen scope.

## Updates

### 2026-09-26

- Created from the user's on-device report and their direction on locking.
