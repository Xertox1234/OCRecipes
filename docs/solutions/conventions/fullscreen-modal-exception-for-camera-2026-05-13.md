---
title: fullScreenModal exception for camera and scanner screens
track: knowledge
category: conventions
module: client
tags: [react-native, navigation, camera, modal, ios]
applies_to: [client/navigation/**/*.tsx]
created: '2026-05-13'
---

# fullScreenModal exception for camera and scanner screens

## Rule

Use `presentation: "fullScreenModal"` instead of `transparentModal` for camera/scan screens. `transparentModal` has rendering issues on iOS that cause visual artifacts, and `fullScreenModal`'s black background is acceptable because the camera feed fills the screen immediately.

## Examples

```typescript
<Stack.Screen
  name="Scan"
  component={ScanScreen}
  options={{
    headerShown: false,
    // fullScreenModal intentional — transparentModal had rendering issues
    presentation: "fullScreenModal",
    animation: "slide_from_bottom",
  }}
/>
```

## Why

`transparentModal` is the default recommendation for full-screen overlays, but it has rendering issues that cause visual artifacts on some iOS versions. Camera screens don't benefit from transparency anyway since the camera feed is opaque, so `fullScreenModal` is the better choice.

## Exceptions

When to use: Camera screens, barcode scanners, or any full-screen view where the content fills the screen with a dark/opaque background.

When NOT to use: Detail views or overlays where the previous screen should remain visible underneath. Use `transparentModal` for those.

## See Also

- [Full-screen detail with transparentModal](../design-patterns/full-screen-detail-transparent-modal-2026-05-13.md)
- [Camera `isActive`: Include in-screen overlay state](camera-isactive-include-overlay-state-2026-05-13.md)
