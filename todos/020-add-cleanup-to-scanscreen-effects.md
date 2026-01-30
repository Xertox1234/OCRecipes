---
title: "Add cleanup functions to ScanScreen useEffect hooks"
status: ready
priority: low
created: 2026-01-30
updated: 2026-01-30
assignee:
labels: [bug, react-native, code-review]
---

# Add Cleanup to ScanScreen Effects

## Summary

The timeout created in `handleBarCodeScanned` is stored in a ref but never cleaned up on unmount, potentially causing memory leaks or state updates on unmounted components.

## Background

**Location 1:** `client/screens/ScanScreen.tsx:88-99`

```typescript
scanTimeoutRef.current = setTimeout(() => {
  navigation.navigate("NutritionDetail", { barcode: result.data });
  setTimeout(() => {
    setIsScanning(false);  // Could update state after unmount
    lastScannedRef.current = null;
    scanSuccessScale.value = 0;
  }, 500);
}, 300);
```

**Location 2:** `client/screens/ScanScreen.tsx:50-58`

```typescript
useEffect(() => {
  cornerOpacity.value = withRepeat(...);
}, []);  // No cleanup function
```

## Acceptance Criteria

- [ ] Add cleanup function to clear timeout on unmount
- [ ] Clear any pending timeouts when component unmounts
- [ ] Add cleanup for animation if needed

## Implementation Notes

```typescript
useEffect(() => {
  return () => {
    if (scanTimeoutRef.current) {
      clearTimeout(scanTimeoutRef.current);
    }
  };
}, []);

// For animation, Reanimated handles cleanup automatically,
// but if you want to be explicit:
useEffect(() => {
  cornerOpacity.value = withRepeat(
    withSequence(
      withTiming(1, { duration: 1000 }),
      withTiming(0.6, { duration: 1000 }),
    ),
    -1,
    true,
  );

  return () => {
    cancelAnimation(cornerOpacity);
  };
}, []);
```

## Dependencies

- None

## Risks

- None - bug fix

## Updates

### 2026-01-30
- Initial creation from code review
