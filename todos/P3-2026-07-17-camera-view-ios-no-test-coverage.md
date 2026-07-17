<!-- Filename: P3-2026-07-17-camera-view-ios-no-test-coverage.md -->

---

title: "CameraView.ios.tsx (AVFoundation useObjectOutput path) has zero test coverage"
status: backlog
priority: low
created: 2026-07-17
updated: 2026-07-17
assignee:
labels: [deferred, camera, testing]
github_issue:

---

# CameraView.ios.tsx (AVFoundation useObjectOutput path) has zero test coverage

## Summary

`client/camera/components/CameraView.ios.tsx` — the iOS-specific barcode/object-scanning
implementation (`useObjectOutput`, AVFoundation metadata objects) — has no dedicated test
file. `client/camera/components/__tests__/CameraView.test.tsx` only exercises the
cross-platform `CameraView.tsx` (`useBarcodeScannerOutput`/MLKit path).

## Background

Discovered while investigating a report that barcode auto-capture never locks on iOS
(2026-07-17). Vitest's module resolution doesn't pick up the `.ios.tsx` platform extension
under the current config, so this file's `mapBarcodeTypes`/`useObjectOutput` wiring — and any
future changes to it — ship with zero automated coverage, verifiable only on a physical
device or iOS simulator with a real camera (which the simulator doesn't have).

## Acceptance Criteria

- [ ] Vitest can resolve and test `.ios.tsx`-suffixed files (config change, e.g. a
      `moduleFileExtensions`/resolve alias for the iOS test project, or an explicit
      per-file test target)
- [ ] `CameraView.ios.tsx` has a test file mirroring `CameraView.test.tsx`'s coverage
      (barcode/object type mapping, `onObjectsScanned` wiring, output memoization)

## Implementation Notes

- The mapping functions (`mapBarcodeTypes`, `mapObjectToResult`) are pure and could be
  extracted to a `-utils.ts` file (matching the project's established pattern) to get
  unit coverage without needing `.ios.tsx` resolution solved first — that's the
  low-effort partial fix if the Vitest config change proves out of scope.

## Scope Contract

- **Mechanisms to use:** standard Vitest config + the existing `*-utils.ts` extraction pattern — nothing new
- **Files in scope:** `client/camera/components/CameraView.ios.tsx`, a new `CameraView.ios-utils.ts` (optional), `vitest.config.ts`
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None

## Risks

- Vitest may not support `.ios.tsx` resolution without meaningful config surgery — the
  utils-extraction fallback avoids that risk if so

## Updates

### 2026-07-17

- Filed during barcode-lock regression investigation (see PR for the accompanying fix)
