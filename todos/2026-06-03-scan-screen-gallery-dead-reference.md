---
title: "Wire expo-image-picker gallery flow or remove gallery references in ScanScreen"
status: backlog
priority: low
created: 2026-06-03
updated: 2026-06-03
assignee:
labels: [deferred, camera]
github_issue:
---

# Wire expo-image-picker gallery flow or remove gallery references in ScanScreen

## Summary

`ScanScreen` Alert messages and `CameraUnavailable` subtitle tell users to "use the gallery" but no `expo-image-picker` path exists in this flow. `expo-image-picker` IS installed (`~17.0.11`) but not wired.

## Background

Deferred from 2026-06-03 full audit (L12). Confirmed by researcher: `expo-image-picker` is installed and `launchImageLibraryAsync` needs no extra permissions on modern OS — it just needs wiring. Files: `client/screens/ScanScreen.tsx:349,391`.

## Acceptance Criteria

- [ ] EITHER: wire `expo-image-picker` `launchImageLibraryAsync` as the fallback path in `CameraUnavailable` and the Alert action, feeding the result into the existing photo analysis flow
- [ ] OR: remove "use the gallery" copy from Alert messages and `CameraUnavailable` subtitle if gallery support is not planned
- [ ] No dead-end UX paths remain

## Implementation Notes

If implementing the gallery path: call `launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 })` and pipe the URI through the same `uploadPhotoForAnalysis` path as the shutter button. The gallery picker does not require special permissions on iOS 14+/Android 11+.

## Dependencies

- Product decision: implement gallery or remove the copy?

## Risks

- Low either way; wiring is straightforward, removal is trivial

## Updates

### 2026-06-03

- Initial creation (deferred from full audit L12)
