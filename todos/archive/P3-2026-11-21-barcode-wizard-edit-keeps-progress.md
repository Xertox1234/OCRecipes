---
title: "Decide what "Edit" on the barcode wizard's review steps should keep"
status: done
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

- [x] Edit on a wizard review step returns to that step with the barcode and earlier photos intact
- [x] Retake from FrontLabelConfirm in the wizard returns to the wizard, not a fresh HUNTING
- [x] Saving from the wizard path ends on NutritionDetail (no pop(2) that skips it)
- [x] Tests cover the Edit round-trip and the save route

## Implementation Notes

Likely needs the wizard state to survive the edit round-trip (route params or a scan-session store) and FrontLabelConfirm to branch on its entry mode. Files: `client/screens/ScanScreen.tsx`, `client/screens/FrontLabelConfirmScreen.tsx`, tests.

## Updates

### 2026-11-21

- Filed from the camera audit (deferred at triage)

### 2026-11-22

- Owner decision: keep progress — Edit/Retake returns to the same wizard step with the barcode and earlier photos kept, and saving continues to NutritionDetail as normal.
- Owner follow-up decision: Retake in place (the step-2 review shows no values, so there was nothing to edit). Done: a `RETAKE_STEP` reducer action re-arms the camera for the same step (STEP2_REVIEWING → LABEL_PROMPTED; STEP3_REVIEWING → STEP2_CONFIRMED, keeping the nutrition photo); ScanScreen deletes only the discarded photo and no longer navigates, so the blur reset never runs. The wizard no longer opens FrontLabelConfirm or LabelAnalysis, so its Retake/pop(2) shape no longer applies to the wizard; finishing goes to NutritionDetail as before (tests: reducer RETAKE_STEP cases, ScanScreen step-2 and step-3 retake round-trips ending on NutritionDetail). A values editor was out of scope (not filed: owner chose retake-only).
