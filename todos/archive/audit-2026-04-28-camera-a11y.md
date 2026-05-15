---
title: "Camera/RN-UX: OCR race lifecycle + accessibility gaps (2026-04-28 audit)"
status: in-progress
priority: medium
created: 2026-04-28
updated: 2026-04-28
assignee:
labels: [camera, accessibility, react-native]
---

# Camera/RN-UX: OCR Race Lifecycle + Accessibility Gaps

## Summary

The new OCR race+swap flows have minor lifecycle and UX gaps. Several screens are missing accessibility properties. `useScanClassification` omits `localOCRText` on one navigation path. One animation is missing cleanup.

## Background

From the 2026-04-28 audit (M10, M11, M12, M13, L18, L19, L20). C1 (isFocused) and H4/H5 (ReceiptReviewScreen error handling) are already fixed.

## Acceptance Criteria

- [ ] **M10** `useScanClassification.ts:121` — pass `localOCRText` (from the last captured OCR result) to `MenuScanResult` navigation params; requires the hook to hold a ref to the latest OCR frame text
- [ ] **M11** `ReceiptCaptureScreen.tsx:72` — add `haptics.notification(Haptics.NotificationFeedbackType.Error)` on capture error (matching `ScanScreen.tsx:342`)
- [ ] **M12** `ScanScreen.tsx:199` — add `return () => cancelAnimation(cornerOpacity)` in the `reducedMotion = false` branch of the animation `useEffect`
- [ ] **M13** `ReceiptReviewScreen.tsx:223` — add `accessibilityLabel` to both editable `TextInput` fields (e.g. `"Item name"` and `"Quantity"`)
- [ ] **L18** `MenuScanResultScreen.tsx:360` — add `accessibilityLiveRegion="polite"` to the AI-update toast `Animated.View`
- [ ] **L19** `ReceiptReviewScreen.tsx:475` — add `accessibilityState={{ disabled: confirmMutation.isPending || items.length === 0 }}` to the raw `Pressable` confirm button
- [ ] **L20** `ReceiptCaptureScreen.tsx` and `ReceiptReviewScreen.tsx` — add `accessibilityViewIsModal` to root containers (matching `FrontLabelConfirmScreen`)

## Implementation Notes

For M10: `useScanClassification` receives `ocrResult` from `ScanScreen` via the frame processor callback. The hook would need a `latestOCRTextRef` that is updated by the frame processor. Alternatively, the `imageUri` classification result could carry the OCR text alongside it.

## Updates

### 2026-04-28

- Created from audit findings M10, M11, M12, M13, L18, L19, L20
