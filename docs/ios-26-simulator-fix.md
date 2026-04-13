# iOS 26 Simulator Build Fix

## Problem

Google MLKit (pulled in via `react-native-vision-camera-ocr-plus`) ships old-style fat binary `.framework` files where the arm64 slice is tagged for iOS **device**. iOS 26 simulators are arm64-only and reject device-tagged binaries. This causes two issues:

1. **`xcodebuild` can't discover simulators** — The `EXCLUDED_ARCHS[sdk=iphonesimulator*] = arm64` setting in MLKit's xcconfig files tells xcodebuild "this project can't target arm64 simulators." Since iOS 26 has no x86_64 simulators, xcodebuild sees zero valid destinations and hides them all.

2. **Linker rejects platform mismatch** — Even if you strip `EXCLUDED_ARCHS`, the linker checks `LC_BUILD_VERSION` in each `.o` file and rejects arm64 objects tagged for platform `IOS` (2) when building for `iOS-simulator`.

## Solution

Two changes in `ios/Podfile` post_install hook + a Python script:

### 1. Strip `EXCLUDED_ARCHS` (restores simulator discovery)

The Podfile `post_install` hook removes `EXCLUDED_ARCHS[sdk=iphonesimulator*] = arm64` from:

- Pod project build settings
- Pod target build settings
- Generated `.xcconfig` files

### 2. Re-tag MLKit arm64 binaries (fixes linker)

`scripts/patch-mlkit-simulator.py` patches the `LC_BUILD_VERSION` load command in every MLKit framework's arm64 slice, changing the platform field from `IOS` (2) to `IOSSIMULATOR` (7). It handles:

- **Fat binaries** — extracts arm64 via `lipo`, patches, recombines
- **Static archives (.a)** — patches in-place without extracting members (avoids losing duplicate-named .o files)
- **BSD long names** — handles `#1/N` archive member name format
- **Direct Mach-O objects** — patches single object files in fat binaries

The script is called automatically by the Podfile `post_install` hook after every `pod install`.

## Affected Frameworks (9 total)

- MLImage.framework
- MLKitCommon.framework
- MLKitVision.framework
- MLKitNaturalLanguage.framework
- MLKitTextRecognition.framework
- MLKitTextRecognitionChinese.framework
- MLKitTextRecognitionDevanagari.framework
- MLKitTextRecognitionJapanese.framework
- MLKitTextRecognitionKorean.framework

MLKitTranslate.framework and MLKitTextRecognitionCommon.framework are also patched when they contain iOS-tagged content.

## When This Fix Is Needed

- Building for iOS 26+ simulator on Apple Silicon
- Any time `pod install` runs (the hook re-patches automatically)
- After `expo prebuild --clean` (regenerates the Podfile — make sure the post_install hook is preserved)

## When This Fix Can Be Removed

When Google ships MLKit as XCFrameworks (with separate arm64 device and arm64 simulator slices) instead of fat binaries via CocoaPods. Track: https://github.com/nicklauslittle/react-native-vision-camera-ocr/issues

## Files

- `ios/Podfile` — post_install hook (strips EXCLUDED_ARCHS + calls patch script)
- `scripts/patch-mlkit-simulator.py` — binary patching script

## Troubleshooting

**`expo prebuild --clean` broke the simulator build**  
The `--clean` flag regenerates the entire `ios/` directory from the Expo template, which produces a default Podfile without the MLKit fix. Run `expo prebuild` (without `--clean`) to preserve Podfile customizations.

**Build fails with "building for iOS-simulator but linking object built for iOS"**  
The patch script didn't run or missed a framework. Run manually:

```bash
python3 scripts/patch-mlkit-simulator.py ios/Pods
```

Then rebuild with `npx expo run:ios`.

**`xcodebuild` shows no simulators in destination list**  
The `EXCLUDED_ARCHS` stripping didn't take effect. Check that the Podfile post_install hook is present and run `pod install` again.
