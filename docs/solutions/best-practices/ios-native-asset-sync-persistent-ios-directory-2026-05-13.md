---
title: "iOS native asset sync for persistent ios/ directory (icon, splash, colour)"
track: knowledge
category: best-practices
tags: [ios, expo, prebuild, assets, icon, splash, rebrand]
module: client
applies_to: ["ios/**", "assets/images/**", "app.json"]
created: 2026-05-13
---

# iOS native asset sync for persistent ios/ directory (icon, splash, colour)

## When this applies

`npx expo run:ios` only runs `expo prebuild` when the `ios/` directory does not exist. Because this project keeps a persistent `ios/` directory (with custom Podfile patches for MLKit), **changes to `assets/images/icon.png`, `assets/images/splash-icon.png`, or `app.json` splash config are silently ignored by subsequent builds.** You must manually sync these files in the iOS asset catalog after any asset change.

## Examples

### App icon (`assets/images/icon.png`)

```bash
cp assets/images/icon.png \
  ios/OCRecipes/Images.xcassets/AppIcon.appiconset/App-Icon-1024x1024@1x.png
```

### Splash screen image (`assets/images/splash-icon.png`)

```bash
LOGO_DIR="ios/OCRecipes/Images.xcassets/SplashScreenLogo.imageset"
SRC="assets/images/splash-icon.png"
sips -z 200 200 "$SRC" --out "$LOGO_DIR/image.png"
sips -z 400 400 "$SRC" --out "$LOGO_DIR/image@2x.png"
cp "$SRC" "$LOGO_DIR/image@3x.png"
```

### Splash background colour

`ios/OCRecipes/Images.xcassets/SplashScreenBackground.colorset/Contents.json`: colours are stored as 0–1 float components per channel, not hex. Convert:

```
#FAF6F0 → red: 0.9804, green: 0.9647, blue: 0.9412   (light)
#1E1814 → red: 0.1176, green: 0.0941, blue: 0.0784   (dark)
```

### After syncing, always clear the build cache and simulator

```bash
rm -rf ~/Library/Developer/Xcode/DerivedData/OCRecipes-*
xcrun simctl shutdown <simulator-id> && xcrun simctl erase <simulator-id>
# Then rebuild:
npx expo run:ios
```

## Why

The simulator icon/splash cache is separate from Xcode's DerivedData cache — both must be cleared. Deleting the app from the simulator alone is not sufficient; the Springboard icon cache persists until the simulator is erased.

Origin: 2026-04-25 rebrand — icon and splash changes in `app.json` and `assets/images/` had no effect on the build until the iOS asset catalog was manually updated.
