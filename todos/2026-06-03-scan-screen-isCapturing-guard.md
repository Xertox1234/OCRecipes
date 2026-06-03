---
title: "Add isCapturingRef guard to ScanScreen.onShutterPress to prevent duplicate captures"
status: backlog
priority: low
created: 2026-06-03
updated: 2026-06-03
assignee:
labels: [deferred, camera]
github_issue:
---

# Add isCapturingRef guard to ScanScreen.onShutterPress to prevent duplicate captures

## Summary

`ScanScreen.onShutterPress` has no capture-in-progress guard — `scanPhaseRef` updates via `useEffect` (post-render), so two rapid taps both pass the phase check and enter `HUNTING` concurrently. In label mode this causes duplicate `navigate("LabelAnalysis")` calls stacking screens; in smart-photo mode it races two `uploadPhotoForAnalysis` calls.

## Background

Deferred from 2026-06-03 full audit (M5). Confirmed by researcher: VisionCamera v5 docs confirm no built-in concurrent-capture guard. File: `client/screens/ScanScreen.tsx:337-421`.

## Acceptance Criteria

- [ ] `isCapturingRef.current = true` set at start of onShutterPress, `false` on completion or error
- [ ] Second tap while capturing returns early
- [ ] No duplicate navigate or uploadPhotoForAnalysis calls under rapid tapping
- [ ] Existing scan flow unaffected

## Implementation Notes

Add `const isCapturingRef = useRef(false)` pattern (same as `isActioning` in BeveragePickerSheet). Set at the start of `onShutterPress`, clear in the `finally` block. Ref matches `scanPhaseRef` pattern already used in the same file.

## Dependencies

- None

## Risks

- Ensure the guard is cleared on camera permission errors, not just happy path

## Updates

### 2026-06-03

- Initial creation (deferred from full audit M5)
