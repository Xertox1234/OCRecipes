---
title: "Decide what "Edit" on the barcode wizard's review steps should keep"
status: backlog
priority: low
created: 2026-11-21
updated: 2026-11-22
assignee:
labels: [deferred, camera, client]
github_issue:
---

# Decide what "Edit" on the barcode wizard's review steps should keep

## Summary

Camera audit 2026-11-21 finding, deferred at triage by the owner. Source: `docs/audits/2026-11-21-camera.md` (local manifest).

## Background

`client/screens/ScanScreen.tsx:928-953` (`onEditStep2`/`onEditStep3`) navigate away; the blur effect then runs `resetScan`, discarding the wizard's barcode and nutrition photo. `client/screens/FrontLabelConfirmScreen.tsx:100-114, 249-256` assumes the front-label stack shape (`goBack`/`pop(2)`): from the wizard, Retake lands on a fresh HUNTING and a successful save pops Scan too, skipping the NutritionDetail hand-off. A UX question for the owner, not a confirmed bug.

## Acceptance Criteria

- [ ] Edit on a wizard review step returns to that step with the barcode and earlier photos intact
- [ ] Retake from FrontLabelConfirm in the wizard returns to the wizard, not a fresh HUNTING
- [ ] Saving from the wizard path ends on NutritionDetail (no pop(2) that skips it)
- [ ] Tests cover the Edit round-trip and the save route

## Implementation Notes

Likely needs the wizard state to survive the edit round-trip (route params or a scan-session store) and FrontLabelConfirm to branch on its entry mode. Files: `client/screens/ScanScreen.tsx`, `client/screens/FrontLabelConfirmScreen.tsx`, tests.

## Updates

### 2026-11-21

- Filed from the camera audit (deferred at triage)

### 2026-11-22

- Owner decision: keep progress — Edit/Retake returns to the same wizard step with the barcode and earlier photos kept, and saving continues to NutritionDetail as normal.
