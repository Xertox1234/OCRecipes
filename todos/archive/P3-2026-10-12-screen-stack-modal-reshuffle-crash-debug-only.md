---
title: "Debug build crashes when a link opens a modal while a sheet is closing after a dark/light switch"
status: done
priority: low
created: 2026-10-12
updated: 2026-10-16
assignee:
labels: [deferred, navigation]
github_issue:
---

# Debug build crashes when a link opens a modal while a sheet is closing after a dark/light switch

## Summary

The debug (dev-client) build aborts with `Modally presented controllers are being reshuffled, this is not allowed` (`node_modules/react-native-screens/ios/RNSScreenStack.mm:623`) when three things line up. The owner chose on 2026-10-12 not to fix it, because no real user can trigger it. This todo keeps the repro in case that changes.

## Background

Found during the PR #1417 simulator check, then isolated on 2026-10-12 (iPhone 17 Pro simulator, iOS 26.5, react-native-screens 4.16.0).

All three of these are needed:

1. A root `modal` sheet is open (GoalSetup: Profile → Settings → Nutrition Goals).
2. While it is open, iOS switches appearance (dark → light).
3. The sheet is swiped closed, and within about 2 seconds an `ocrecipes://` link presents a `fullScreenModal` (`ocrecipes://recipe-chat`).

Results: the full combination crashed 2 of 2 times. Leaving out any one part (no link, no sheet, or no swipe) survived each time (runs A, B and C).

The abort happens in the completion of RecipeChat's present animation. A modal update queued during that animation (`scheduleModalsUpdate`) runs `updateContainer`, and the new modal list puts an already-presented controller after the common prefix. The check is an `RCTAssert`, which release builds compile out (`NS_BLOCK_ASSERTIONS`). What a release build does on the same path has NOT been measured.

Why no real user can reach it: the client never opens an `ocrecipes://` link itself (every `Linking.openURL` targets an external https page). There is no `setNotificationHandler`, so pushes only show while the app is in the background, and tapping one foregrounds the app after any sheet animation has ended. Only a script (`simctl openurl`) can deliver a link mid-dismissal.

react-native-screens 4.29.0 has the same assertion (line 427), so upgrading would not fix it. Expo 54 pins `~4.16.0` anyway.

## Acceptance Criteria

- [ ] Re-open only if the app gains a way to present a modal on its own (in-app `ocrecipes://` links, foreground push banners, a timer or listener that navigates into a modal route), or if a release build is shown to crash on this path.
- [ ] If re-opened: first measure what a release-equivalent build does (comment out line 623, rebuild, re-run the repro) and fix whatever actually fails. The assertion detects inconsistent `_presentedModals` bookkeeping; it is not the cause.

## Implementation Notes

Repro script (UDID and helper paths are this machine's):

```bash
U=<sim UDID>; AXE=<bundled axe path>
# with the GoalSetup sheet open:
xcrun simctl ui $U appearance dark   # wait ~2s
xcrun simctl ui $U appearance light
$AXE swipe --start-x 200 --start-y 110 --end-x 200 --end-y 750 --udid $U
# wait ~1s
xcrun simctl openurl $U ocrecipes://recipe-chat
# app process is gone ~3s later; the sim log shows the assertion
```

- Native code: `node_modules/react-native-screens/ios/RNSScreenStack.mm` → `setModalViewControllers:`.
- App side: `client/navigation/linking.ts` (`subscribe`), `client/navigation/RootStackNavigator.tsx` (GoalSetup `modal`, RecipeChat `fullScreenModal`).
- No Vitest test can cover a UIKit presentation race; the simulator script is the check.

## Scope Contract

- **Mechanisms to use:** none until a re-open condition is met.
- **Files in scope:** the files named above.
- No new mechanisms.

## Dependencies

- None.

## Updates

### 2026-10-12

- Isolated and filed. Owner ruling: note it and move on (it can't be reached by users).

### 2026-10-16

- Re-checked every re-open condition on `/todo`: none met. All `Linking.openURL` calls target external https pages; no `setNotificationHandler` in `client/`; the only listener is the notification-tap handler in `client/navigation/linking.ts`, which runs after foregrounding; react-native-screens still 4.16.0. Owner chose to archive so backlog sweeps stop re-picking it. Re-open from `todos/archive/` if a condition above becomes true.
