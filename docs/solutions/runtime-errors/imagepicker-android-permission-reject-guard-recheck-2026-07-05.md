---
title: 'expo-image-picker: Android rejects the launcher on permission denial — guard the recheck too'
track: bug
category: runtime-errors
module: client
severity: medium
tags: [expo, expo-image-picker, permissions, android, camera, react-native, error-handling]
symptoms: [Unhandled promise rejection when opening camera or gallery after a permission is denied on Android, iOS silently resolves as canceled on permission denial but Android rejects the launcher promise instead, A permission-denied Settings alert is shown for an unrelated ImagePicker failure like busy hardware or full storage]
applies_to: [client/components/**/*.tsx, client/screens/**/*.tsx]
created: '2026-07-05'
---

# expo-image-picker: Android rejects the launcher on permission denial — guard the recheck too

## Problem

`ImagePicker.launchCameraAsync` / `launchImageLibraryAsync` behave differently per platform when the OS permission is denied: iOS resolves the promise as if the user cancelled (`{ canceled: true }`), but Android **rejects** the promise instead. Code that only pre-checks permission with `requestCameraPermissionsAsync()` / `requestMediaLibraryPermissionsAsync()` and assumes the subsequent launcher call is now safe will get an unhandled promise rejection on Android — the permission can be revoked between the check and the launch, and the launcher's own enforcement doesn't perfectly mirror the request call's result.

A naive fix (wrap the launcher in try/catch, show a "please enable access in Settings" alert on any caught error) creates a second, subtler bug: **any** unrelated failure (no camera hardware, disk full, a genuine native-module error) gets mislabeled as a permission problem, sending the user to Settings for something a Settings toggle can't fix.

## Symptoms

- Unhandled promise rejection when opening camera or gallery after a permission is denied on Android
- The same code path works fine on iOS but crashes/rejects on Android for the identical user action
- A "grant access in Settings" alert appears for failures that have nothing to do with permissions

## Root Cause

Expo's iOS `ImagePicker` implementation treats a denied permission as a normal no-op path. The Android native implementation throws/rejects directly from the launcher call when the permission isn't granted at invocation time, even if a pre-check ran moments earlier. A bare `catch { showPermissionDeniedAlert() }` then compounds this by treating the catch block as proof of a permission failure, when it only proves *some* promise rejected.

## Solution

1. Wrap the launcher call in try/catch (the permission pre-check stays outside the try, or is the first statement inside it — either way, the pre-check's own early `return` on a denied status is the common/fast path).
2. In the catch, **re-verify** the actual permission status via `getCameraPermissionsAsync()` / `getMediaLibraryPermissionsAsync()` before deciding whether to show the Settings alert. Only show it if the recheck confirms `status !== "granted"`. If the recheck shows the permission is still granted, the rejection was unrelated — stay silent rather than mislabel it.
3. Guard the recheck call **itself** in a nested try/catch. If the recheck also throws (e.g. the app's native permission declaration is missing entirely), don't let that escape as a second unhandled rejection — the cause is undeterminable, so stay silent.
4. Keep any success-path side effects (dismissing a sheet, forwarding the picked asset) **outside** the try/catch, reachable only via normal completion — otherwise they can fire from within an exception-handling path by accident.

```tsx
let result: ImagePicker.ImagePickerResult;
try {
  const { status } = await ImagePicker.requestCameraPermissionsAsync();
  if (status !== "granted") {
    showPermissionDeniedAlert("Camera");
    return;
  }
  result = await ImagePicker.launchCameraAsync({
    mediaTypes: ["images"],
    quality: 0.9,
  });
} catch {
  try {
    const { status } = await ImagePicker.getCameraPermissionsAsync();
    if (status !== "granted") showPermissionDeniedAlert("Camera");
  } catch {
    // Cause is undeterminable — stay silent rather than guess.
  }
  return;
}
if (result.canceled || !result.assets[0]) return;
onDismiss();
onPhotoImport(result.assets[0].uri, mealType, plannedDate);
```

## Prevention

- Never assume a permission pre-check makes the subsequent launcher call safe on Android — try/catch the launcher call too, even right after a successful check.
- Never label every caught error as a permission problem — re-verify status before choosing the user-facing message.
- Guard every fallback/recovery path (the recheck) as carefully as the primary path — a "safety net" call that can itself throw isn't a safety net.
- Write a test for both "permission denied" and "launcher rejects for an unrelated reason" — they require different UI responses, and a suite that only covers the first will miss a mislabeling regression.

## Related Files

- `client/components/meal-plan/ImportRecipeSheet.tsx` — `handleCamera` / `handleGallery`
- `client/components/meal-plan/__tests__/ImportRecipeSheet.test.tsx` — covers granted, denied, unrelated-rejection, and recheck-itself-rejects cases

## See Also

- [Alert.alert is acceptable for blocking system decisions](../conventions/inline-validation-errors-2026-05-13.md) — when a permission-denied dialog is the right exception to the "use InlineError, not Alert.alert" rule
