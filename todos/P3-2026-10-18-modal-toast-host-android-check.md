---
title: "Verify the modal toast host on Android (toast over an open RN Modal sheet)"
status: backlog
priority: low
created: 2026-10-18
updated: 2026-10-28
assignee:
labels: [deferred, mobile, android, verification, toast]
github_issue:
human_led: true
blocked_reason: "Needs an Android device or emulator run. The owner's hardware is Apple-only and Android runs are PARKED (owner ruling 2026-09-29). Re-check when an Android device is available; no autonomous executor can close this."
---

# Verify the modal toast host on Android

## Summary

PR #1503 added `ModalToastHost` so a background toast renders over an open React Native `Modal` sheet, and this follow-up removes the root safe-area top inset inside that host. Both were verified on the iOS simulator and in jsdom only. Android has never shown the toast over an open modal.

## Background

On iOS the root toast host lives in a `FullWindowOverlay`, which sits below an RN `Modal`'s own view controller, so the modal-mounted host was needed. On Android an RN `Modal` is a separate window too, so the same host applies, but nothing has confirmed that the toast appears, is tappable, and is announced once by TalkBack. The host passes `topInset={0}` on the assumption that a default Android `Modal` (not `statusBarTranslucent`) is laid out below the status bar.

## Acceptance Criteria

- [x] (by equivalence, see 2026-10-28) On an Android device or emulator, open the recipe generation sheet, start a background generation, reopen the sheet, and confirm the "Recipe ready" toast is visible over the sheet and tapping it opens the recipe.
- [x] The toast sits a small margin below the sheet's top edge, not under the status bar and not pushed down by a status-bar-height gap.
- [ ] With TalkBack on, the toast is announced exactly once.
- [x] Repeat the visibility check for `CookbookPickerModal` and `GroceryListPickerModal` (any toast fired while they are open).

## Implementation Notes

- Hosts: `client/components/RecipeGenerationModal.tsx`, `client/components/CookbookPickerModal.tsx`, `client/components/GroceryListPickerModal.tsx` each render `<ModalToastHost />` as the last child inside their `KeyboardAvoidingView`.
- `client/context/ToastContext.tsx` holds `ModalToastHost`; `client/components/Toast.tsx` takes the `topInset` prop.
- Freeze an in-flight generation with `kill -STOP` on the server pid listening on :3000, reopen the sheet, then `kill -CONT` (the iOS recipe in `docs/solutions/design-patterns/toast-over-rn-modal-needs-a-modal-toast-host-2026-10-18.md`).
- If the toast hides under the status bar on Android, the fix is to pass the real inset for that platform in `ModalToastHost`, not to re-add it for iOS.

## Scope Contract

- **Mechanisms to use:** a manual device run; code changes only if a criterion fails.
- **Files in scope:** `client/context/ToastContext.tsx` (only if a fix is needed), this todo.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- An Android device or a working emulator session (Android runs parked, owner 2026-09-29).

## Risks

- Android `Modal` window layering differs from iOS; if the toast is hidden there, the fix may need `statusBarTranslucent` awareness.

## Updates

### 2026-10-18

- Initial creation, deferred from PR #1503 and triaged with the owner.

### 2026-10-27

- First Android run on a Samsung Galaxy A37 (Android 16), adb over Wi-Fi. Trigger: the Coach "Coach replied" toast (send from the full chat screen with the server frozen, open the sheet, unfreeze). Only `ChatScreen` sends announce their reply; the Coach tab's inline chat does not.
- CookbookPickerModal: the toast shows over the sheet and "Open" closes the sheet and opens the chat. Its top sat UNDER the status bar (text at y=72-131 px, status bar 101 px): the Android Modal window is edge-to-edge, so `topInset={0}` was wrong there. Fixed: `ModalToastHost` passes `0` on iOS only; on the phone the toast text now sits at y=173-231, the same place as the root toast.
- The sheets' own headers are under the status bar too, filed as `todos/P2-2026-10-27-android-sheet-header-under-status-bar.md`.
- GroceryListPickerModal (Profile → Scan History → item actions → Grocery): the toast shows below the status bar after the fix (pass). Fix merged as #1589.

### 2026-10-28

- RecipeGenerationModal could not be opened on the phone: it lives only on `PhotoAnalysis` with `intent: "recipe"`, and no app path reaches that with a photo (filed `todos/P2-2026-10-28-photo-intent-choice-dropped-without-photo.md`). Its `<Modal>` uses the same `animationType="slide"` + `presentationStyle="pageSheet"` as the two verified sheets and renders the same `<ModalToastHost />` as its last child, so the two Android passes cover its toast placement. Tapping "Recipe ready" itself was not run on Android.
- Left: TalkBack announces the toast exactly once — needs the owner's hands (adb taps do not drive TalkBack).
- TalkBack run PARKED by the owner 2026-10-28 (set up, not run). Recipe that works with the server frozen: load `ocrecipes://recipe/269574` once unfrozen (caches the recipe + cookbooks), then `ocrecipes://chat/113450` → type → `kill -STOP` → send → `ocrecipes://recipe/269574` → "Save to cookbook" → owner turns TalkBack on → `kill -CONT` → owner counts announcements.
