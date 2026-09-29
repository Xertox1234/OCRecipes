---
title: "App icon assets are JPEG bytes with a .png extension — expo-doctor's config-schema check fails"
status: in-progress
priority: low
created: 2026-09-26
updated: 2026-09-26
assignee:
labels: [deferred, react-native]
github_issue:
---

# App icon assets are JPEG bytes with a .png extension — expo-doctor's config-schema check fails

## Summary

`assets/images/icon.png` and `assets/images/android-icon-foreground.png` contain JPEG data despite their `.png` names. `npx expo-doctor`'s config-schema check fails on them.

## Background

Found while triaging expo-doctor for #1106 (Expo SDK skew decision, 2026-09-26). That todo's scope excluded binary assets, so it was left unfixed. App icons are usually expected to be real PNGs. The Android adaptive-icon foreground needs transparency, which JPEG can't hold. Whether the current EAS builds tolerate this (Expo may re-encode during prebuild) wasn't verified.

## Acceptance Criteria

- [x] Confirm the format with `file assets/images/icon.png assets/images/android-icon-foreground.png`.
- [x] Replace each with a genuine PNG at the same dimensions, preserving the exact appearance (format-only fix, no re-render). **Transparency NOT addressed** — see Updates: the Android adaptive-icon foreground still has an opaque background (it is byte-identical to `icon.png`) and needs real transparent source art from the user before that half of this line can be considered done.
- [x] `npx expo-doctor` no longer reports the config-schema failure for these files.
- [x] Note that icon changes reach devices only through a new build, not OTA — see Updates.

## Implementation Notes

- Don't just rename or re-save a JPEG as PNG if it has an opaque background where transparency is needed; that changes how the Android adaptive icon looks. Ask the user for the original artwork if needed.

## Scope Contract

- **Files in scope:** `assets/images/icon.png`, `assets/images/android-icon-foreground.png`.

## Dependencies

- None

## Updates

### 2026-09-29

- **Format fix landed, appearance unchanged.** Both files were opaque 1024×1024 JPEGs (`sips -g hasAlpha` = no, confirmed before and after). Converted in place with `sips -s format png <file> --out <file>` — no crop/resize/re-render, no synthesized transparency. Post-conversion: `file` reports genuine `PNG image data, 1024 x 1024, 8-bit/color RGB, non-interlaced` for both; `sips -g hasAlpha` still `no` (unchanged); dimensions unchanged at 1024×1024; size grew from 509.3K to 1.8M each (expected — lossless PNG of photographic content vs. lossy JPEG). The two files remain MD5-identical to each other before and after (`b70451f0...` → `37af9ef8...`), confirming `android-icon-foreground.png` is still a byte-for-byte copy of `icon.png`, not an isolated foreground layer.
- **expo-doctor delta measured, not assumed.** Before: 13/18 checks passed, 5 failed, including "Check Expo config (app.json/app.config.js) schema" with all 4 asset-format errors (`icon`, `Android.adaptiveIcon.foregroundImage` × 2 each — extension-vs-content mismatch). After: 14/18 passed, 4 failed; a line-by-line diff of the saved before/after output confirms the config-schema block is the _only_ thing that changed — the other 4 failures (direct `expo-modules-core` dependency, duplicate native deps, non-CNG asset-sync warning, SDK version skew) are pre-existing, unrelated, and byte-identical before/after. `npx expo-doctor` still exits non-zero overall; this todo only closes the config-schema failure, not the other four.
- **Adaptive-icon foreground transparency — OPEN, needs the user.** `android-icon-foreground.png` is an opaque copy of the full icon photo (confirmed via the MD5 match above), which defeats `app.json`'s `android.adaptiveIcon.backgroundColor: "#FAF6F0"` (the background can never show through an opaque foreground). Per the orchestrator's ruling, this fix intentionally does NOT synthesize transparency — that would alter the artwork. **Surfaced to the user**: real transparent foreground-only source art is needed to finish this half of AC #2; until then the Android adaptive icon will render correctly-formatted but visually as today (full opaque photo, background colour never visible).
- **New build required, not OTA — and it's stronger than that for Android.** `expo-doctor`'s own "non-CNG project" check states that with persistent `ios/`/`android/` directories present, EAS Build does not sync `icon`/`android` config from `app.json` at all — native asset sync is manual. Per `docs/solutions/best-practices/ios-native-asset-sync-persistent-ios-directory-2026-05-13.md`, the iOS asset catalog copy (`ios/OCRecipes/Images.xcassets/AppIcon.appiconset/App-Icon-1024x1024@1x.png`) is a separate, manually-`cp`'d file — measured to already be a genuine 1024×1024 PNG today, so no iOS action is needed for this format fix specifically. Android's real device assets are prebuild-generated `mipmap-*/ic_launcher*.webp` files derived from the source PNG at prebuild time, not a direct copy — so this source-level fix only reaches an Android device after a prebuild/new native build regenerates those mipmaps; it will never arrive via OTA.
- **Root cause (out of scope here, surfaced for awareness):** `scripts/generate-app-assets.ts` calls `generateImage()` in `server/lib/runware.ts`, which never sets `outputFormat: "PNG"` on the Runware request, so the model defaults to JPEG bytes. `assets/images/favicon.png` and `assets/images/splash-icon.png` have the identical defect (JPEG bytes, `.png` name) but are outside this todo's Scope Contract — not touched.
- Archived as `done` on this basis: the config-schema failure this todo exists to fix is verified fixed; the adaptive-icon transparency question is a separate, user-gated follow-up, not a blocker for closing the format fix.
