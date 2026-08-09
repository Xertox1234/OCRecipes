---
title: "Verify a barcode actually DECODES on Android (VisionCamera 5.1.1 + MLKit 9)"
status: backlog
priority: low
created: 2026-08-08
updated: 2026-08-08
assignee:
labels: [camera, barcode, android, verification, deferred]
github_issue:
human_led: true
blocked_reason: "Needs a REAL Android device. Proven over two sessions 2026-08-08 that the emulator cannot do it: the virtual-scene camera cannot be aimed at an injected poster by ANY means — adb cannot drive it (`adb emu physics` only records), and mouse drag and WASD are both inert while the guest app holds the camera. Do not retry on the emulator. No autonomous executor can close this."
---

# Verify a barcode actually DECODES on Android (VisionCamera 5.1.1 + MLKit 9)

## Summary

`useBarcodeScannerOutput` — the Android barcode path — has **never** been
observed producing a result. Everything around it is verified; this one step
never was, and the code is already shipped on `main`.

## Background

This is the sole residual of
`todos/archive/P2-2026-07-25-mlkit-9-unblock-visioncamera-511.md`, which was
archived 2026-08-08 at 7 of 8 criteria. Filed separately so the gap resurfaces if
an Android device ever becomes available — the archived todo records it, but
nothing would surface it.

**What IS verified on Android** (2026-08-08, emulator, PRs #780/#781):

- Gradle resolves the MLKit family cleanly — `barcode-scanning:17.3.0` and
  `text-recognition:16.0.1` coexist, which is exactly what CocoaPods refused on
  iOS. `libbarhopper_v3.so` is packaged for all four ABIs.
- The app builds, installs, launches, logs in, and the **camera mounts**:
  `ActiveCameraSessionSingle: … Type: OPEN | Error: null`.
- The **bundled MLKit barcode module loads in-process**:
  `DynamiteModule: Selected local version of com.google.mlkit.dynamite.barcode`.
- Zero `react_native_assert` / `SIGABRT` / `ElfError`. (This also retired the
  #729 prediction that Android would hit the same `enableJsiParser` crash as
  iOS — `patches/react-native-vision-camera+5.1.1.patch` covers Android.)

**What is NOT verified:** a barcode being decoded and the product resolving.
The untested surface is narrow but real, and it is live.

⚠️ **If Android barcode scanning is ever reported broken, start HERE — do not
open a regression hunt.** There is no commit that broke it; it was never proven
working. iOS uses a different path entirely (`useObjectOutput` / AVFoundation),
so an iOS pass says nothing about this.

## Acceptance Criteria

- [ ] On a **physical Android device**, scanning a real product barcode in the
      app's Barcode mode produces a lock — i.e. `useBarcodeScannerOutput`
      actually yields a value.
- [ ] The scanned barcode resolves to a product against the backend (proves the
      decoded value is correct, not merely that _something_ fired).
- [ ] The result is recorded in the archived todo's Updates section, and its
      `archived_with_residual` frontmatter field is cleared or amended.

## Implementation Notes

- **Do not attempt this on the emulator.** Two sessions established the
  virtual-scene camera cannot be pointed at an injected poster:
  `adb emu virtualscene-image` swaps only the texture on two fixed surfaces
  (`wall`, `table`); `adb emu physics` only _records_ poses; the accelerometer
  does not steer the view while an app holds the camera; and mouse drag and WASD
  are both inert. `-camera-back webcam0` works but requires a human physically
  holding a barcode to the Mac's webcam — not automatable, and it was not
  attempted.
- Build **one ABI** for a device: `-PreactNativeArchitectures=arm64-v8a`. The
  four-ABI APK is ~306 MB and fails to install with
  `INSTALL_FAILED_INSUFFICIENT_STORAGE`.
- Grant up front to avoid dialogs stealing UI automation:
  `adb shell pm grant com.ocrecipes.app android.permission.CAMERA` and
  `adb shell appops set com.ocrecipes.app SYSTEM_ALERT_WINDOW allow` — without
  the second, expo-dev-client opens the "Display over other apps" Settings page
  _on top of the app_.
- Check `EXPO_PUBLIC_DOMAIN` in `.env` matches the host's **current** LAN IP
  (`ipconfig getifaddr en0`) before blaming anything else — this trap has bitten
  three times, and a failed login is displayed as "Incorrect username or
  password" rather than a network error
  (`docs/solutions/logic-errors/network-failure-rendered-as-wrong-credentials-2026-08-08.md`).
- Full recipe:
  `docs/solutions/best-practices/android-emulator-camera-verification-no-hardware-2026-08-08.md`.

## Scope Contract

- **Mechanisms to use:** device verification only — run the existing app and
  observe. No code changes are expected; if the decode fails, that is a defect
  to report, not to fix under this todo.
- **Files in scope:** `todos/archive/P2-2026-07-25-mlkit-9-unblock-visioncamera-511.md`
  (record the result) and this file. Nothing else.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- **A physical Android device.** None is available as of 2026-08-08; that is the
  entire reason this is deferred rather than done.
