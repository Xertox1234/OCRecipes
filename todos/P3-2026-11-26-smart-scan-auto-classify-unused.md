---
title: "Smart scan auto-classify path is unreachable from the guided camera"
status: backlog
priority: low
created: 2026-11-26
updated: 2026-11-26
assignee:
labels: [deferred, camera]
github_issue:
---

# Smart scan auto-classify path is unreachable from the guided camera

## Summary

After the guided scan camera stage 1, every generic camera entry point carries `intent: "log"`, so the smart auto-classify capture path (photo -> classify -> chip) is reachable only through an unknown or malformed `intent` param. Record it; do not delete it (owner rule: unused is not removable, possibly unfinished work).

## Background

`navigate("Scan")` with no params is now the guided barcode flow (`getScanFlow` in `client/screens/scan-screen-utils.ts`). The generic photo callers (home Photo Food Log, QuickLog camera, Coach chat camera, camera teaching toast "Try it", History scan button) moved to `navigate("Scan", { intent: "log" })`, which skips classification in `captureSmart` (`client/screens/ScanScreen.tsx`, the `pickedIntent` branch) and goes straight to the intent destination. Generic flows also no longer scan barcodes. The only route into `SMART_PHOTO_INITIATED` is an `intent` that fails `isScanIntent` (`client/screens/photo-intent-utils.ts`), e.g. a malformed CoachChat-forwarded param.

## Acceptance Criteria

- [ ] Owner decides: revive auto-classify as a real entry point, or remove the path below
- [ ] If removed, the exhaustive `ScanPhase` switches and their tests are updated together

## Implementation Notes

Unreachable in normal use (verified present 2026-11-26):

- Phases in `client/camera/types/scan-phase.ts`: `CLASSIFYING`, `SMART_CONFIRMED`, `SMART_ERROR`
- Reducer action `SMART_PHOTO_INITIATED` (`client/camera/types/scan-phase.ts`; handled in `client/camera/reducers/scan-phase-reducer.ts`, with `CLASSIFICATION_SUCCEEDED` / `CLASSIFICATION_FAILED` / the SMART_CONFIRMED -> SMART_ERROR transition)
- ProductChip variants `smart_photo`, `smart_error` (`client/camera/components/ProductChip-utils.ts`, `client/camera/components/ProductChip.tsx`)
- `resolveSmartConfirmAction` in `client/screens/scan-screen-utils.ts`, used in `client/screens/ScanScreen.tsx`
- Exhaustive-switch arms for the three phases in `client/camera/shell/barcode-flow.ts`, `client/camera/components/CoachHint-utils.ts`, `client/camera/components/ScanReticle-utils.ts`, `client/screens/scan-screen-utils.ts`

Record, don't delete, per the owner's rule.

## Scope Contract

- **Mechanisms to use:** none new; this todo is a record.
- **Files in scope:** the files listed above, only if the owner chooses removal.
- No new mechanisms, files, or abstractions.

## Dependencies

- Guided scan camera stage 1 (branch `docs/scan-guided-camera-spec`)

## Risks

- Removing the phases touches several exhaustive switches; do it in one PR.

## Updates

### 2026-11-26

- Filed during guided scan camera stage 1, Task 9
