---
title: "Decide what "Edit" on the barcode wizard's review steps should keep"
status: backlog
priority: low
created: 2026-11-21
updated: 2026-11-21
assignee:
labels: [deferred, camera, client, product-decision]
github_issue:
---

# Decide what "Edit" on the barcode wizard's review steps should keep

## Summary

Camera audit 2026-11-21 finding, deferred at triage by the owner. Source: `docs/audits/2026-11-21-camera.md` (local manifest).

## Background

`client/screens/ScanScreen.tsx:928-953` (`onEditStep2`/`onEditStep3`) navigate away; the blur effect then runs `resetScan`, discarding the wizard's barcode and nutrition photo. `client/screens/FrontLabelConfirmScreen.tsx:100-114, 249-256` assumes the front-label stack shape (`goBack`/`pop(2)`): from the wizard, Retake lands on a fresh HUNTING and a successful save pops Scan too, skipping the NutritionDetail hand-off. A UX question for the owner, not a confirmed bug.

## Acceptance Criteria

- [ ] Owner decides the intended Edit/Retake/save behaviour from the wizard
- [ ] If changed: tests cover Edit → return keeps progress, and save routes to NutritionDetail

## Implementation Notes

Likely needs the wizard state to survive the edit round-trip (route params or a scan-session store) and FrontLabelConfirm to branch on its entry mode. Files: `client/screens/ScanScreen.tsx`, `client/screens/FrontLabelConfirmScreen.tsx`, tests.

## Updates

### 2026-11-21

- Filed from the camera audit (deferred at triage)
