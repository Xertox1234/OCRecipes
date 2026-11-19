---
title: "Share the takePicture handle and Camera render shell between the two CameraViews"
status: backlog
priority: low
created: 2026-11-19
updated: 2026-11-19
assignee:
labels: [deferred, maintainability, client, camera]
github_issue:
---

# Share the takePicture handle and Camera render shell between the two CameraViews

## Summary

Maintainability audit 2026-11-19 finding, deferred at triage by the owner: a structural refactor that deserves its own PR and review.

## Background

After the 2026-11-19 audit's L1 fix (useCameraSessionReporting + CameraUnavailable), jscpd still pairs `client/camera/components/CameraView.ios.tsx:179-203 ↔ CameraView.tsx:178-203` (the `useImperativeHandle` takePicture with its once-latch) and `:203-236 ↔ :203-237` (the GestureDetector / Camera / FocusRing / ZoomLabel render). The platform split itself is deliberate (different native scanner outputs).

Source: `docs/audits/2026-11-19-maintainability.md` (local manifest).

## Acceptance Criteria

- [ ] A shared piece (e.g. `useTakePictureHandle(ref, photoOutput)` and/or a `CameraShell` component) removes both jscpd pairs
- [ ] Platform-specific scanner outputs stay in their own files
- [ ] `npx jscpd@5.0.12 client/camera/components --min-tokens 100` reports no CameraView ↔ CameraView pair; camera tests green

## Implementation Notes

- Hooks must stay above the `!device` early return.
- Review: mobile-reviewer.
- Behaviour-preserving refactor: existing tests stay green; new pure helpers get tests first.

## Scope Contract

- **Mechanisms to use:** existing patterns only (extract module / hook / pure function) — nothing new.
- **Files in scope:** client/camera/components/CameraView.ios.tsx, client/camera/components/CameraView.tsx, client/camera/hooks/**, client/camera/components/**
- No new mechanisms, files, or abstractions beyond those listed.

## Risks

- Behaviour drift during the move — keep it a pure restructuring and diff behaviour against the existing tests.

## Updates

### 2026-11-19

- Filed from the 2026-11-19 maintainability audit (deferred at triage).
