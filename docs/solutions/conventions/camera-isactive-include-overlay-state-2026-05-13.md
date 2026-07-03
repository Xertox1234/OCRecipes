---
title: 'Camera `isActive`: include in-screen overlay state'
track: knowledge
category: conventions
module: client
tags: [react-native, camera, vision-camera, battery, scanning]
applies_to: [client/screens/ScanScreen.tsx, client/screens/**/Scan*.tsx, client/components/**/Camera*.tsx]
created: '2026-05-13'
---

# Camera `isActive`: include in-screen overlay state

## Rule

`isActive={isFocused}` stops the camera when _navigating away_, but not when an overlay appears _within_ the same screen. If a confirm card, bottom sheet, or any in-screen UI element logically "pauses" the camera, extend `isActive` to include that state.

## Examples

```typescript
// Camera runs behind the confirm overlay — wastes battery, can still fire scan callbacks
<CameraView isActive={isFocused} />

// Hardware pipeline halts while overlay is visible
<CameraView isActive={isFocused && !confirmCard} />
```

## Why

A ref guard (e.g. `hasLockedRef`) only prevents _processing_ barcode frames — the camera sensor, ISP, and frame transfer pipeline all continue running on the hardware thread. `isActive={false}` halts the pipeline at the VisionCamera level: real battery and thermal savings, not just a JS-side skip.

## Exceptions

When to use: any state that represents the user logically leaving the scanning interaction without navigating away — confirm dialogs, permission prompts, loading overlays, inline result cards.

## Related Files

- `client/screens/ScanScreen.tsx` — confirm overlay (audit 2026-05-02 H4)

## See Also

- [fullScreenModal exception for camera](fullscreen-modal-exception-for-camera-2026-05-13.md)
