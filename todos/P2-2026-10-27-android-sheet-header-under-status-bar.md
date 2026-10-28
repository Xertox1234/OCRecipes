---
title: "Android: the three pageSheet sheets draw their header under the status bar"
status: backlog
priority: medium
created: 2026-10-27
updated: 2026-10-27
assignee:
labels: [deferred, mobile, android]
github_issue:
---

# Android: the three pageSheet sheets draw their header under the status bar

## Summary

On Android the "Save to Cookbook" sheet's title runs into the clock and its close ✕ sits on the battery icon. The same layout is in the grocery-list picker and the recipe generation sheet. Give their header the real status-bar inset on Android only.

## Background

Seen on a Samsung Galaxy A37, Android 16, 2026-10-27, during the modal-toast Android check (`todos/P3-2026-10-18-modal-toast-host-android-check.md`). The three sheets open as `<Modal presentationStyle="pageSheet">`. iOS shows a card below the status bar; Android ignores `pageSheet` and opens a full-screen window, and that window is edge-to-edge (Expo's prebuild warns "Android 16 makes edge-to-edge mandatory" and no longer lets an app opt out). So the sheet's content starts at y=0, under the 101 px status bar. The toast inside these sheets had the same cause and was fixed in `ModalToastHost` (Android keeps the safe-area top); the sheet headers were outside that todo's scope.

The other 8 `<Modal>`s in `client/` are not `pageSheet` and were not checked here.

## Acceptance Criteria

- [ ] On an Android phone, each sheet's title and close button sit below the status bar, not under the clock or icons.
- [ ] iOS is unchanged: no extra gap above the sheet header (iOS sim screenshot).
- [ ] With a toast showing over the sheet on Android, the toast still sits a small gap below the status bar.

## Implementation Notes

- Headers: `client/components/CookbookPickerModal.tsx` (styles `paddingTop: Spacing.lg`, ~line 406), `client/components/GroceryListPickerModal.tsx` (~line 375), `client/components/RecipeGenerationModal.tsx` (inline `paddingTop: Spacing.lg`, ~line 142). Each already calls `useSafeAreaInsets()`.
- Add `Platform.OS === "android" ? insets.top : 0` to the header's top padding. Don't change iOS.
- Device check recipe: `docs/solutions/design-patterns/toast-over-rn-modal-needs-a-modal-toast-host-2026-10-18.md`. A change to a context or shared component may not fast-refresh on the phone; force-stop and relaunch the app before judging.

## Scope Contract

- **Mechanisms to use:** the existing `useSafeAreaInsets()` in each sheet, a `Platform.OS` check.
- **Files in scope:** the three sheet files above and their tests.
- No new shared component or hook.

## Updates

### 2026-10-27

- Filed from the Android modal-toast check (screenshot of the cookbook sheet on the phone).
