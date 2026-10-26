---
title: "Split ScanScreen's confirm overlay, permission gate and capture routing"
status: backlog
priority: medium
created: 2026-10-26
updated: 2026-10-26
assignee:
labels: [deferred, maintainability, client, camera]
github_issue:
---

# Split ScanScreen's confirm overlay, permission gate and capture routing

## Summary

`ScanScreen.tsx` is one ~1150-line component; extract the confirm overlay and permission gate, and let the capture plan own the mode routing.

## Background

Audit finding M7. Inline confirm overlay (~170 JSX + ~70 lines of derived values/handlers at `:353-424`, `:1086-1255`, although `ScanScreenConfirmOverlay-utils.ts` already exists), inline camera-permission gate (`:716-780`), and `onShutterPress` (`:551-700`) re-branching `isFrontLabelMode`/`isLabelMode`/`verifyBarcode` inside the "smart" route while `getCapturePlan(phase)` (`scan-screen-utils.ts:330`) advertises an exhaustive switch.

Deferred from the 2026-10-25 `/audit maintainability` run (user triage: the large refactors become todos, each its own PR with its own review). Discovery: `code-reviewer` with the maintainability-checklist lens; every cited line was re-read and grep-verified by the orchestrator before filing.

## Acceptance Criteria

- [ ] `ScanConfirmOverlay` and `CameraPermissionGate` components extracted
- [ ] `getCapturePlan(phase, mode)` returns `frontLabel | label | smart | step`; one small capture function per route; the in-callback mode branches are gone
- [ ] Screen reduced by ~300 lines
- [ ] Behaviour unchanged: existing tests for the touched files pass without edits to their assertions (new tests may be added)
- [ ] No file in scope ends above 600 lines unless it started there and shrank

## Implementation Notes

Camera is device-only: the simulator has no camera. Keep `isActive={isFocused}`. Unit-test `getCapturePlan` exhaustively.

## Scope Contract

- **Mechanisms to use:** extraction/move of existing code only — no new runtime behaviour
- **Files in scope:** `client/screens/ScanScreen.tsx`, `client/screens/scan-screen-utils.ts`, `client/screens/ScanScreenConfirmOverlay-utils.ts`, new `client/components/scan/{ScanConfirmOverlay,CameraPermissionGate}.tsx`, their `__tests__`
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None

## Risks

- Capture flows (front label, label, verify barcode) can only be fully checked on a phone — owner device pass after merge.

## Updates

### 2026-10-26

- Initial creation from the 2026-10-25 maintainability audit
