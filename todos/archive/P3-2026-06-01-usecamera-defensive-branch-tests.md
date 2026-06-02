---
title: "Cover useCamera post-unmount batch guard + BATCH_MAP_MAX_SIZE eviction"
status: done
priority: low
created: 2026-06-01
updated: 2026-06-01
assignee:
labels: [deferred, testing]
github_issue:
---

# Cover the two untested defensive branches in useCamera

## Summary

Two real defensive branches in `client/camera/hooks/useCamera.ts` are exercised by no test: the post-unmount batch guard (`useCamera.ts:76`) and the `BATCH_MAP_MAX_SIZE` eviction (`useCamera.ts:87-97`). Add real-SUT tests for both.

## Background

Surfaced during the PR #317 review (`todos/archive/2026-05-31-test-quality-2.md`). That PR converted `useCamera.test.ts` from a tautological re-implementation to real-SUT tests via `renderHook`. The old tests _appeared_ to cover an `isActiveRef`-false case, but they set `isActiveRef.current = false` on a fake inline object — the real hook's `isActiveRef` is internal and only flips false on **unmount** (the cleanup effect, `useCamera.ts:54-62`), so the real `if (!isActiveRef.current) return` branch was never actually exercised. Removing the fake test lost no real coverage but made the genuine gap visible. The 200-entry batch-map eviction (added later) was likewise never covered.

These are defensive branches (prevent setState-after-unmount / unbounded Map growth in long batch sessions), so the gap is low-severity — but they are real code paths and cheaply coverable now that the test exercises the real hook.

## Acceptance Criteria

- [ ] Add a test for the post-unmount batch guard (`useCamera.ts:76`): in batch mode, capture `result.current.handleBarcodeScanned` before `unmount()`, then call it after unmounting and assert the `onBarcodeScanned` callback does NOT fire and no React act/`setState-after-unmount` warning is emitted.
- [ ] Add a test for `BATCH_MAP_MAX_SIZE` eviction (`useCamera.ts:87-97`): in batch mode, scan 201 distinct barcodes (`BATCH_MAP_MAX_SIZE = 200`), then re-scan the first barcode within the debounce window and assert it is treated as new (`isRepeat=false`, callback fires) because its Map entry was evicted.
- [ ] Both tests exercise the REAL `useCamera` hook (no inline re-implementation) and pass; no net reduction in real coverage.

## Implementation Notes

- File: `client/camera/hooks/__tests__/useCamera.test.ts` (add to the existing `useCamera — batch mode` describe block, or a new `useCamera — defensive branches` block).
- Follow the patterns already established in that file by PR #317: `@vitest-environment jsdom`, `renderHook`/`act` from `@testing-library/react`, `vi.useFakeTimers()` in `beforeEach`.
- For the unmount test, `renderHook` returns `{ result, unmount }`. Grab the handler reference before calling `unmount()` since `result.current` is no longer driven after unmount.
- For eviction, `BATCH_MAP_MAX_SIZE` is a module-private const (200) — don't import it; just use 201 distinct barcodes and rely on the documented cap. The eviction deletes the **oldest** inserted key (`scannedBarcodesRef.current.keys().next().value`), so the first-scanned barcode is the one evicted.

## Dependencies

- Follows PR #317 (`todos/archive/2026-05-31-test-quality-2.md`). Not blocking.

## Risks

- Low. Pure test additions against an unchanged production hook. The unmount-warning assertion can be slightly environment-sensitive — if no clean warning hook is available, asserting "callback not called" alone is sufficient signal for the guard.

## Updates

### 2026-06-01

- Filed from the PR #317 code review. The two branches were masked by tautological tests that PR #317 removed; this todo covers them for real.
