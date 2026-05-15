---
title: "Camera/scan polish from 2026-04-18 audit"
status: in-progress
priority: medium
created: 2026-04-18
updated: 2026-04-18
labels: [camera, rn-ui-ux, audit-2026-04-18]
---

# Camera/scan polish from 2026-04-18 audit

## Summary

Six camera flow polish items. The H12 stale-closure fix landed in the main pass; these are consistency/perf items.

## Findings (cross-ref `docs/audits/2026-04-18-full.md`)

- **M33** — ScanScreen `useCamera.onBarcodeScanned` callback calls `haptics.notification(Success)` explicitly AND `triggerScanFlash()` which internally fires `Haptics.notificationAsync(Success)` — double haptic per scan. Remove the explicit call (the flash hook owns the haptic per the codified pattern).
- **L17** — `useCamera.scannedBarcodesRef` Map grows unbounded in batch mode (bounded in practice by BatchScanScreen's MAX_ITEMS=50). Add size cap to hook.
- **L18** — `BatchScanScreen` doesn't call `resetScanning()` alongside `startSession()` — stale map timestamps could suppress re-scans on fast refresh.
- **L21** — `ScanScreen.onBarcodeScanned` callback not memoized — re-registers native scanner every render. Wrap in `useCallback`.

Cross-referenced in `coach-followups-2026-04-18.md`:

- **L19** — `CookSessionCaptureScreen` sets `isActive={false}` during analyzing → preview freezes behind overlay.
- **L20** — `useScanClassification.isClassifyingRef` not reset on blur.

## Acceptance Criteria

- [ ] Double haptic removed from ScanScreen
- [ ] `scannedBarcodesRef` Map size-capped
- [ ] `BatchScanScreen` resets scanning on session start
- [ ] `ScanScreen.onBarcodeScanned` memoized

## Updates

### 2026-04-18

- Created from 2026-04-18 audit deferrals.
