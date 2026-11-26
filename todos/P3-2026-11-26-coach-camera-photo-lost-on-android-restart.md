---
title: "Coach photo: a camera photo is lost when Android destroys the app while the camera is open"
status: backlog
priority: low
created: 2026-11-26
updated: 2026-11-26
assignee:
labels: [deferred, react-native, camera]
github_issue:
human_led: true
---

# Coach photo: a camera photo is lost when Android destroys the app while the camera is open

## Summary

`pickCoachPhoto` (`client/lib/coach-photo-picker.ts`) awaits `ImagePicker.launchCameraAsync` and never calls `ImagePicker.getPendingResultAsync`. On Android, when the OS destroys the app's activity while the camera is open, the photo is lost and the user is told nothing. Coach chat audit 2026-11-24, L28, first half.

## Background

Deferred from audit bundle J (2026-11-26) because it has open design questions and can only be checked on an Android device. To reproduce, turn on Developer options → "Don't keep activities". The simulator can't reproduce it.

The second half of L28 needs no code change. A remounted chat could start a second photo while the first is still uploading, but the server refuses an overlapping turn in the same conversation: `rejectOverlappingChatTurn` in `server/routes/chat-photo.ts` returns `REQUEST_IN_FLIGHT`, and the chat shows "The Coach is still answering".

Open questions for the owner:

- What should a recovered photo do? Never auto-send it: that is a paid turn with no user action, and it could go into the wrong chat. The options are a prompt ("Send the photo you just took?") or a plain line telling the user the photo was lost.
- Where should recovery run? After activity destruction the JS app restarts, and the Coach chat may not be the screen that mounts.
- `getPendingResultAsync` covers the whole app, and other screens launch the camera too. A recovered result has to be claimed only when this hook launched it, which needs a marker that survives a process restart (for example, AsyncStorage set before launch and cleared after).

## Acceptance Criteria

- [ ] The owner has picked what a recovered photo does (prompt or message).
- [ ] A recovered result is claimed only when the Coach photo picker launched the camera.
- [ ] Nothing is ever sent without a user action.
- [ ] Checked on the Android phone with "Don't keep activities" on.

## Implementation Notes

- Installed `expo-image-picker` 58.0.10: `getPendingResultAsync(): Promise<ImagePickerResult | ImagePickerErrorResult | null>`. It returns `null` off Android.
- Files in scope: `client/lib/coach-photo-picker.ts`, `client/hooks/useCoachPhotoSend.ts`, and the Coach chat screen that hosts the hook.
