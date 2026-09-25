---
title: "Coach reminder notification taps are lost on cold launch and before the navigator is ready — route them through linking"
status: done
priority: medium
created: 2026-09-23
updated: 2026-09-23
assignee:
labels: [deferred, audit, reliability]
github_issue:
---

# Coach reminder notification taps are lost on cold launch and before the navigator is ready — route them through linking

## Summary

Tapping a Coach commitment-reminder notification that cold-launches the app does nothing, because the launch response is never read. The listener also drops the tap outright when `navigationRef` isn't ready yet.

## Background

Found by the 2026-09-23 front-end audit (read-only, 6 lenses + Context7 research). Finding ID(s): **M26** in `docs/audits/2026-09-23-frontend.md` (local-only, gitignored). Each claim below was re-read against the code at HEAD `3df8b4b3`; line numbers may drift.

- `client/App.tsx:118-127`: `addNotificationResponseReceivedListener` → `navigationRef.navigate("NotebookEntry")` guarded by `isReady()`; nothing calls `getLastNotificationResponseAsync` / `useLastNotificationResponse` (grep).
- Reminders are scheduled in `client/hooks/useNotebookNotifications.ts:44-56` with `data: { entryId }`.
- Warm taps while logged out are NOT dropped: `RootStackNavigator.tsx:231` sets `UNSTABLE_routeNamesChangeBehavior="lastUnhandled"`, which replays after login. (The discovery agent rated this High; research demoted it.)
- Research (React Navigation 7 deep-linking "Integrate Expo Notifications"; expo-notifications `getLastNotificationResponseAsync`): `better-fix`. Handle notifications in `linking.getInitialURL` (falling back to `Notifications.getLastNotificationResponseAsync()`) and `linking.subscribe` (wrapping the response listener), with the notification carrying a `…/notebook/:entryId` URL. `NotebookEntry` is already mapped in `client/navigation/linking.ts:37-39`.

## Acceptance Criteria

- [x] A cold-launch tap on a reminder opens the NotebookEntry (after login, if logged out)
- [x] A warm tap before the navigator is ready is not dropped
- [x] Reminder payloads carry a URL (existing scheduled reminders with only `entryId` still work, or are migrated)
- [x] Tests for getInitialURL/subscribe handling
- [x] Failing test written first (TDD), then the fix; the test fails on current `main` and passes after.

## Implementation Notes

Follow the React Navigation 7 docs example exactly. Verify on a simulator with a scheduled local notification.

## Scope Contract

- **Mechanisms to use:** existing project patterns cited above — nothing new beyond what the acceptance criteria name.
- **Files in scope:**
  - `client/App.tsx`
  - `client/navigation/linking.ts`
  - `client/hooks/useNotebookNotifications.ts`
  - matching `__tests__/`
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None

## Risks

- Already-scheduled reminders on user devices carry the old payload — keep backward compatibility.

## Updates

### 2026-09-23

- Initial creation from the 2026-09-23 front-end audit (M26).

### 2026-09-25

- Implemented. `client/navigation/linking.ts` gained `getInitialURL`/`subscribe`
  per the React Navigation 7 + expo-notifications integration pattern, with a
  fallback from an `entryId`-only payload (the server push scheduler's permanent shape, not just old builds) to a full-prefix URL.
- **Deviation from Implementation Notes** ("follow the docs example exactly"):
  source-reading the installed `@react-navigation/native`/`@react-navigation/core`
  packages showed the vanilla `getInitialURL`/`subscribe` example alone does not
  satisfy AC2 ("a warm tap before the navigator is ready is not dropped") — React
  Navigation's own `dispatch`/`resetRoot` silently no-op (no retry) when no
  navigator has registered a focus listener yet, which is exactly the boot-time
  window before `AuthContext`'s first `checkAuth()` resolves. Added a small
  pending-URL hold in `linking.ts`, flushed via `NavigationContainer`'s existing
  `onReady` prop (wired in `App.tsx`) — no new library or architectural layer.
  Both review agents (code-reviewer, mobile-reviewer) independently re-verified
  this against the installed source and ruled it in-scope.
- Tests assert URL forwarding into React Navigation's own listener; they cannot
  observe React Navigation's own replay behavior
  (`UNSTABLE_routeNamesChangeBehavior="lastUnhandled"`), which was verified by
  reading the installed source instead. The "verify on a simulator" step in
  Implementation Notes was not run.
- Review: code-reviewer WARNING (comment wording implied the entryId fallback
  was a time-bounded migration bridge; in fact `server/services/
notification-scheduler.ts`'s server-push path — out of this todo's scope —
  sends entryId-only payloads indefinitely) — fixed inline (reworded comments).
  Filed `todos/P3-2026-09-25-notification-scheduler-missing-deep-link-url.md`
  for the actual server-side fix. mobile-reviewer: no findings.
- Independent review: the handled notification response was never cleared, so ErrorBoundary's "Try Again" (which remounts NavigationContainer and re-runs getInitialURL) would re-open the last tapped entry. linking.ts now clears it once turned into a URL, on both the cold-launch and live-tap paths, and only builds the fallback URL for a positive-integer entryId. Tests added, including a round trip of the built URL through the real linking config.
