---
title: "Scan found card: camera pause on lock and the buttons' later beat are not built"
status: backlog
priority: low
created: 2026-11-26
updated: 2026-11-26
assignee:
labels: [deferred, camera]
github_issue:
---

# Scan found card: camera pause on lock and the buttons' later beat are not built

## Summary

The guided scan camera spec's motion plan (`docs/superpowers/specs/2026-11-26-scan-guided-camera-design.md`, motion-plan table) has the camera preview pause when the barcode locks and the found card's buttons arrive a beat after the card body. Stage 1 shipped the found card with its entry spring but without those two beats.

## Background

Deferred during the stage 1 build (Task 5 and Task 8 reports). The found card works and is accessible; this is the polish layer of the "found" moment, which the spec names as a signature moment.

## Acceptance Criteria

- [ ] On `BARCODE_LOCKED` the preview visibly holds (freeze or dim) until Not this / the primary action
- [ ] The card's buttons enter after the title/name, staggered, settling before the user can reach them
- [ ] Reduced motion: no travel or stagger; state change stays (per the spec's reduced-motion column)
- [ ] Checked on a device recording (crafting-ui `frames.mjs video`), not only in code

## Implementation Notes

- Found card: `client/camera/components/ProductChip.tsx` (`barcode_lock` variant), entry via `bannerEntrySpring`
- Camera view and lock handling: `client/screens/ScanScreen.tsx`, `client/camera/shell/CameraShell.tsx`

## Scope Contract

- **Mechanisms to use:** existing `client/constants/animations.ts` configs; a new spring only from crafting-ui `scripts/springs.mjs` with `mass` written.
- **Files in scope:** the two files above plus their tests.
- No new mechanisms, files, or abstractions.

## Dependencies

- Guided scan camera stage 1 (branch `docs/scan-guided-camera-spec`)

## Risks

- Pausing the preview must not stop barcode detection after Not this (re-arm path `rearmScan`).

## Updates

### 2026-11-26

- Filed at the end of guided scan camera stage 1 (final review triage of deferred minors)
