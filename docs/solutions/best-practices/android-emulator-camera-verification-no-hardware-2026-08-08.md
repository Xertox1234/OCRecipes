---
title: Verifying a camera/barcode feature on the Android emulator without physical hardware
track: knowledge
category: best-practices
module: camera
tags: [android, emulator, camera, barcode, mlkit, virtualscene, testing, expo-dev-client, adb, uiautomator]
applies_to: [client/camera/**, client/screens/ScanScreen.tsx, android/**]
created: '2026-08-08'
---

# Verifying a camera/barcode feature on the Android emulator without physical hardware

## When this applies

Any acceptance criterion of the form "barcode/OCR verified on Android" where no
physical Android device exists. The emulator runs the **real** Android MLKit
library and genuinely executes `useBarcodeScannerOutput`, so it covers the
*code path* — which is usually what the criterion is actually about. It cannot
cover Android camera **hardware** behaviour (autofocus quality, lens selection,
low light); treat that as a documented residual, not a blocker.

## Why

Two instincts waste a session here.

The first is `-camera-back webcam0`. Host-webcam passthrough works, but it points
at the Mac's front-facing camera — so it requires a **human physically holding a
barcode** in front of the laptop. It cannot be automated, and it silently turns a
verification task into a manual one.

The second is trusting a hand-made barcode image. If the fixture does not encode
correctly, a failure to scan is **indistinguishable** from an MLKit regression —
and you will debug the app instead of the fixture.

## Examples

**Inject the fixture into the emulated camera instead of holding one up:**

```bash
emulator -avd <AVD> -camera-back virtualscene \
  -virtualscene-poster wall=/path/barcode.png -gpu host

# or at runtime, no restart — only `wall` and `table` exist:
adb emu virtualscene-image wall /path/barcode.png
```

**Verify the fixture independently before trusting it.** macOS Vision is a second
decoder, so it cannot share a bug with MLKit:

```swift
// swift verify.swift barcode.png 5449000000996
let req = VNDetectBarcodesRequest()
try VNImageRequestHandler(cgImage: cg, options: [:]).perform([req])
// → DETECTED symbology=VNBarcodeSymbologyEAN13 payload=5449000000996 confidence=0.99
```

Use a real product code so the lookup half of the flow also resolves — e.g.
EAN-13 `5449000000996` (Coca-Cola 330 mL), which exists in OpenFoodFacts.

**Build one ABI.** Apple Silicon emulators run `arm64-v8a` only; the four-ABI APK
is ~306 MB and dies with `INSTALL_FAILED_INSUFFICIENT_STORAGE` against the AVD's
~6 GB `/data`. One ABI is ~104 MB:

```bash
./gradlew :app:installDebug -PreactNativeArchitectures=arm64-v8a
```

**Grant both permissions up front.** `CAMERA` is obvious; the second is not:

```bash
adb shell pm grant   com.ocrecipes.app android.permission.CAMERA
adb shell appops set com.ocrecipes.app SYSTEM_ALERT_WINDOW allow
```

Without the second, expo-dev-client opens the **"Display over other apps"**
Settings page *on top of the app*. It looks like your taps are drifting into
Settings at random; in fact the overlay prompt is stealing focus.

**Drive the UI from the hierarchy, never fixed coordinates:**

```bash
adb shell uiautomator dump /sdcard/ui.xml && adb pull /sdcard/ui.xml
# parse for class="android.widget.{EditText,Button}" + bounds → tap centres
```

An inline error banner moved this app's Sign In button from y=1330 to y=1488;
a hardcoded tap then lands on whatever moved into that space. Use `KEYCODE_TAB`
to move between fields rather than tapping the second one — the soft keyboard
reflows the form after the first tap, so a second coordinate tap typically
re-focuses the *first* field and concatenates both values into it.

**Wire the API before wondering why login hangs:** `adb reverse tcp:8081` for
Metro, and make sure `EXPO_PUBLIC_DOMAIN` is the host's *current* LAN IP.

## Exceptions

- **`localhost` is not a portable value for `EXPO_PUBLIC_DOMAIN`.** It works for
  the emulator via `adb reverse` but breaks a physical iPhone, which needs the
  LAN IP. Prefer the current LAN IP — it satisfies both.
- **The virtual-scene camera cannot be aimed from `adb`.** It is turned by
  dragging inside the emulator window; `adb emu physics` only *records* poses,
  and the accelerometer does not steer it while an app holds the camera. If the
  poster is behind the default view, a human drag is required — plan for that
  rather than treating it as a failure.

## Related Files

- `client/camera/components/CameraView.tsx` — `useBarcodeScannerOutput` (the Android path)
- `client/screens/ScanScreen.tsx` — scan flow entry, reachable via `ocrecipes://scan`
- `android/gradle.properties` — `reactNativeArchitectures`

## See Also

- [A zero-filled native library passes every structural check](../runtime-errors/zero-filled-native-lib-passes-size-alignment-checks-2026-08-08.md) — a build-artifact failure that surfaces only once the app runs on the emulator
- [Static error copy that collapses every failure into one cause](../logic-errors/network-failure-rendered-as-wrong-credentials-2026-08-08.md) — why a failed login here can misreport the actual connectivity fault
