---
title: "Fix CameraView Android to loop all barcodes instead of only checking barcodes[0]"
status: backlog
priority: low
created: 2026-06-03
updated: 2026-06-03
assignee:
labels: [deferred, camera]
github_issue:
---

# Fix CameraView Android to loop all barcodes instead of only checking barcodes[0]

## Summary

`CameraView.tsx` (Android) only checks `barcodes[0]`. If index 0 maps to null (unsupported format), valid barcodes at index 1+ are silently dropped. The iOS version (`CameraView.ios.tsx`) correctly loops all objects and returns the first valid one.

## Background

Deferred from 2026-06-03 full audit (L10). Confirmed by researcher: VisionCamera 5 docs show `for (const code of codes)` in all examples with no ordering guarantee. File: `client/camera/components/CameraView.tsx:100-107`.

## Acceptance Criteria

- [ ] Android CameraView loops all barcodes and returns the first valid result (matching iOS behavior)
- [ ] A null/unsupported barcode at index 0 does not block processing of index 1+

## Implementation Notes

Replace the `barcodes[0]` index access with a loop matching the `CameraView.ios.tsx` pattern. Use `for (const barcode of barcodes)` and return on first valid value.

## Dependencies

- None

## Risks

- Low — behavior improvement; existing tests for single-barcode case still pass

## Updates

### 2026-06-03

- Initial creation (deferred from full audit L10)
