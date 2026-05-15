---
title: "Add tests for returnAfterLog/confirmCard overlay flow"
status: in-progress
priority: medium
created: 2026-05-02
updated: 2026-05-02
assignee:
labels: [deferred, audit-2026-05-02, code-quality, testing]
---

# Add tests for returnAfterLog/confirmCard overlay flow

## Summary

No test coverage exists for the `returnAfterLog`/`confirmCard` flow: overlay setup, product fetch, Log It / Dismiss interactions, or error recovery. All new async state transitions are untested.

## Background

Deferred from 2026-05-02 full audit (finding M9). The confirm overlay was introduced in recent commits but `client/screens/__tests__/` has no test file covering it. The flow involves:

- SESSION_COMPLETE effect triggering a product info fetch
- `setConfirmCard` with loading/loaded states
- `handleConfirmLog` POST + success/error
- `handleConfirmDismiss` resetting state (just fixed in C1)

## Acceptance Criteria

- [ ] Test: SESSION_COMPLETE with `returnAfterLog=true` shows confirm overlay with "Loading..." state
- [ ] Test: successful product fetch updates overlay with product name + calories
- [ ] Test: tapping "Log It" POSTs, shows success toast, calls `navigation.goBack()`
- [ ] Test: tapping "Dismiss" resets `confirmCard` to null and dispatches `CAMERA_READY`
- [ ] Test: POST failure shows error toast, re-enables button

## Implementation Notes

Extract a `ScanScreenConfirmOverlay-utils.ts` for the async logic (parallel to existing `scan-screen-utils.ts`) and test those pure functions. The overlay render is harder to test without a full component harness — focus on the logic extraction first.

## Dependencies

- None

## Risks

- CameraView mock complexity — ScanScreen tests currently only cover util functions, not the component itself

## Updates

### 2026-05-02

- Initial creation (deferred from audit M9)
