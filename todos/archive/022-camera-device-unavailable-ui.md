---
title: "Handle camera device unavailable state"
status: done
priority: medium
created: 2026-02-01
updated: 2026-02-01
assignee:
labels: [camera, ux, error-handling]
---

# Handle Camera Device Unavailable State

## Summary

When `useCameraDevice` returns null (no camera available), the CameraView silently returns null, leaving users with a blank screen and no feedback.

## Background

**Location:** `client/camera/components/CameraView.tsx` (lines 113-119)

```typescript
if (!device) {
  return null; // Silent failure - user sees nothing
}
```

This can happen on:

- Simulators without camera
- Devices with hardware issues
- When camera is in use by another app

## Acceptance Criteria

- [ ] Show meaningful UI when camera device is unavailable
- [ ] Differentiate between "loading device" and "no device available"
- [ ] Provide actionable guidance (e.g., "Use gallery instead")
- [ ] Consider exposing device state to parent components

## Implementation Notes

Option A - Internal fallback UI:

```typescript
if (!device) {
  return (
    <View style={styles.unavailable}>
      <Feather name="camera-off" size={48} />
      <Text>Camera unavailable</Text>
      <Text>Try using the gallery to upload a photo</Text>
    </View>
  );
}
```

Option B - Expose state via callback prop:

```typescript
interface CameraViewProps {
  onDeviceUnavailable?: () => void;
}
```

## Dependencies

- None

## Risks

- Need to handle edge case where device becomes available after initial null

## Updates

### 2026-02-01

- Initial creation from code review
- **Approved during triage** - Status changed: backlog → ready
