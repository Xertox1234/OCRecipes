---
title: "Fix duplicate camera button in ScanScreen"
status: done
priority: medium
created: 2026-02-01
updated: 2026-02-01
assignee:
labels: [bug, ui, camera]
---

# Fix Duplicate Camera Button in ScanScreen

## Summary

ScanScreen currently has `headerShown: false` in `ScanStackNavigator.tsx` because there's a duplicate camera button appearing in the interface. Fix the duplication so the screen can use the standard header.

## Background

**Location:**

- `client/navigation/ScanStackNavigator.tsx` - sets `headerShown: false`
- `client/screens/ScanScreen.tsx` - likely has its own camera button

The ScanScreen hides the navigator header, which breaks the consistent header styling pattern used elsewhere in the app. Once the duplicate button issue is resolved, the screen can show the header like ProfileScreen does.

## Acceptance Criteria

- [ ] Identify source of duplicate camera button
- [ ] Remove the duplicate button
- [ ] Enable header in ScanStackNavigator (`headerShown: true`)
- [ ] Add HeaderTitle component like ProfileScreen
- [ ] Verify camera functionality still works correctly

## Implementation Notes

Look at how ProfileStackNavigator handles the header:

```typescript
options={{
  headerTitle: () => <HeaderTitle title="Scan" />,
}}
```

## Dependencies

- None

## Risks

- Camera button placement may be intentional for UX reasons
- Need to verify the header doesn't interfere with camera viewfinder

## Updates

### 2026-02-01

- Created from todo 019 discussion
- Identified as blocker for consistent header styling
- **RESOLVED: No action needed** - Analysis confirmed `headerShown: false` is intentional design for full-screen camera UX. ScanScreen has purpose-built overlay controls (torch, close, gallery, shutter) that float over the camera preview. This is the standard pattern for camera screens.
