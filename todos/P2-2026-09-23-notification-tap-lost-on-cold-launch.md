---
title: "Coach reminder notification taps are lost on cold launch and before the navigator is ready — route them through linking"
status: backlog
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

- [ ] A cold-launch tap on a reminder opens the NotebookEntry (after login, if logged out)
- [ ] A warm tap before the navigator is ready is not dropped
- [ ] Reminder payloads carry a URL (existing scheduled reminders with only `entryId` still work, or are migrated)
- [ ] Tests for getInitialURL/subscribe handling
- [ ] Failing test written first (TDD), then the fix; the test fails on current `main` and passes after.

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
