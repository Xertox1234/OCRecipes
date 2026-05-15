---
title: "Implement photo quality option for camera"
status: done
priority: low
created: 2026-02-01
updated: 2026-02-01
assignee:
labels: [camera, enhancement]
---

# Implement Photo Quality Option for Camera

## Summary

The `PhotoOptions.quality` parameter is accepted by the camera abstraction but not actually used when taking photos with react-native-vision-camera.

## Background

**Location:** `client/camera/components/CameraView.tsx` (lines 91-109)

The `takePicture` method accepts a `quality` option but ignores it:

```typescript
takePicture: async (options?: PhotoOptions): Promise<PhotoResult | null> => {
  const photo = await cameraRef.current.takePhoto({
    flash: "off", // quality option is not passed
  });
};
```

react-native-vision-camera uses different quality parameters than expo-camera (e.g., `qualityPrioritization: "quality" | "speed" | "balanced"`).

## Acceptance Criteria

- [ ] Map the 0-1 quality value to vision-camera's qualityPrioritization
- [ ] OR remove quality from PhotoOptions if not supported
- [ ] Update types to reflect actual capabilities

## Implementation Notes

Option A - Map quality:

```typescript
const photo = await cameraRef.current.takePhoto({
  flash: "off",
  qualityPrioritization:
    options?.quality && options.quality > 0.7
      ? "quality"
      : options?.quality && options.quality > 0.3
        ? "balanced"
        : "speed",
});
```

Option B - Remove unused option from interface if vision-camera doesn't support granular quality control.

## Dependencies

- None

## Risks

- Quality mapping may not match user expectations from expo-camera

## Updates

### 2026-02-01

- Initial creation from code review
- **Approved during triage** - Status changed: backlog → ready
