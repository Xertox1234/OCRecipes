---
title: "App icon assets are JPEG bytes with a .png extension — expo-doctor's config-schema check fails"
status: backlog
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

- [ ] Confirm the format with `file assets/images/icon.png assets/images/android-icon-foreground.png`.
- [ ] Replace each with a genuine PNG at the same dimensions. The adaptive-icon foreground needs a transparent background; get the source art from the user if the JPEG has a baked-in background.
- [ ] `npx expo-doctor` no longer reports the config-schema failure for these files.
- [ ] Note that icon changes reach devices only through a new build, not OTA.

## Implementation Notes

- Don't just rename or re-save a JPEG as PNG if it has an opaque background where transparency is needed; that changes how the Android adaptive icon looks. Ask the user for the original artwork if needed.

## Scope Contract

- **Files in scope:** `assets/images/icon.png`, `assets/images/android-icon-foreground.png`.

## Dependencies

- None
