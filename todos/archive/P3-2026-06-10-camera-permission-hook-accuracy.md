<!-- Filename: P{0-3}-YYYY-MM-DD-short-description.md  (P0=critical … P3=low) -->

---

title: "Camera hooks: persisted permission state via canRequestPermission + batch isScanning latch"
status: done
priority: low
created: 2026-06-10
updated: 2026-06-10
assignee:
labels: [deferred, camera]
github_issue:

---

# Camera permission/scanning hook accuracy

## Summary

Two deferred camera-hook findings from the 2026-06-10 full audit (L20, L19):
`useCameraPermissions` synthesizes `canAskAgain` from an in-memory ref so a
prior-session OS denial reports as "undetermined"; `useCamera` batch mode sets
`isScanning` true on the first barcode and never resets it.

## Background

- **L20:** `client/camera/hooks/useCameraPermissions.ts:21-33` uses
  `hasRequestedRef` (resets every launch). After a previous-session denial the
  UI shows "Grant Permission", fires a no-op `requestPermission()`, and only
  then flips to "Open Settings". Research (Phase 2.5): VisionCamera **v5 has no
  `Camera.getCameraPermissionStatus()`** (that was v4) — the v5 way is the
  `canRequestPermission` boolean from `useCameraPermission()`, which reflects
  persisted OS state. Drop the ref, derive `canAskAgain` from it.
- **L19:** `client/camera/hooks/useCamera.ts:100-101` — batch mode latches
  `isScanning` true (single-scan mode resets via timeout). No consumer reads it
  in batch mode today; footgun for any future "scanning…" indicator.

## Acceptance Criteria

- [ ] `useCameraPermissions` derives denied/canAskAgain from `canRequestPermission` (persisted), `hasRequestedRef` removed
- [ ] Cold-start-after-denial renders the Settings deep-link UI on first render (no wasted request)
- [ ] Batch-mode `isScanning` reflects the debounce window (reset path added) or is removed from the batch contract
- [ ] Also consider the NEW-B note: hook computes `permission: permission()` (a fresh object from a useCallback'd fn) — convert to `useMemo` for identity correctness-by-construction

## Implementation Notes

- BatchScanScreen now deps on `permission?.status` (fixed in the audit), so the hook's return-identity churn is no longer load-bearing — this todo is about _accuracy_, not re-render churn.

## Dependencies

- None.

## Risks

- Permission-state changes need on-device verification on both platforms (iOS Simulator can't fully exercise camera permission flows).

## Updates

### 2026-06-10

- Initial creation — deferred from 2026-06-10 full audit (L19, L20).
