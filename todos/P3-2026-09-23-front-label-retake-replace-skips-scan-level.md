---
title: "FrontLabelConfirm Retake replaces itself, so pop(2) lands on the first Scan's live camera"
status: backlog
priority: low
created: 2026-09-23
updated: 2026-09-23
assignee:
labels: [deferred, client]
github_issue:
---

# FrontLabelConfirm Retake replaces itself, so pop(2) lands on the first Scan's live camera

## Summary

`FrontLabelConfirmScreen`'s "Retake" button calls `navigation.replace("Scan", { mode: "front-label", verifyBarcode: barcode })`, which replaces the _current_ screen (FrontLabelConfirm) rather than reusing the Scan(front-label) instance already below it on the stack. After a Retake, the stack gains an extra Scan level, so the eventual successful-confirm `pop(2)` lands one level short — on the first Scan's live camera instead of the screen the flow started from.

## Background

Found while implementing `todos/archive/P3-2026-09-23-front-label-after-verification-lands-on-camera.md`. Traced both entry paths:

- **NutritionDetail entry:** `NutritionDetail → Scan(front-label)#1 [push] → FrontLabelConfirm [push]`. Tap Retake → `replace` swaps FrontLabelConfirm for `Scan(front-label)#2`, giving `NutritionDetail, Scan#1, Scan#2`. Capture → push → `FrontLabelConfirm#2`. Confirm success → `pop(2)` → pops `FrontLabelConfirm#2` and `Scan#2` → lands on `Scan#1`, a live camera, not `NutritionDetail`.
- **Verification entry** (after the sibling todo's fix): same shape one level deeper — Retake still leaves an extra `Scan` level below the final `pop(2)`, landing on a live camera instead of `LabelAnalysis`.

Both paths are affected because the defect is in `FrontLabelConfirmScreen.tsx`'s own Retake handler, independent of which screen pushed the first `Scan(front-label)`.

## Acceptance Criteria

- [ ] After Retake → capture → confirm, the user lands on the same screen a non-Retake confirm would (NutritionDetail, or LabelAnalysis for the verification entry) — never a live camera.
- [ ] The existing non-Retake confirm paths (both entries) are unaffected.
- [ ] A render/unit test pins the corrected navigation call for Retake.

## Implementation Notes

- `client/screens/FrontLabelConfirmScreen.tsx:180` — `handleRetake`'s `navigation.replace("Scan", …)` is the call to fix. Likely fix: `navigation.pop()` (or `goBack()`) back to the existing `Scan(front-label)` instance instead of replacing FrontLabelConfirm with a second one — mirrors how the sibling todo fixed the analogous LabelAnalysis case by keeping the stack shape stable rather than duplicating a level.
- Verify against `docs/solutions/conventions/navigate-vs-replace-modal-flows-2026-05-13.md` (may need another update once this is understood).
- Files in scope: `client/screens/FrontLabelConfirmScreen.tsx`, its test file under `client/screens/__tests__/`.

## Dependencies

- None (independent of the sibling todo it was found alongside; that one is already archived).

## Risks

- Confirm the exact current stack shape for both entries before picking `pop()` vs `goBack()` vs another mechanism — do not assume without tracing, per this project's navigation conventions.

## Updates

### 2026-09-23

- Filed as a deferred Low-severity finding while implementing `P3-2026-09-23-front-label-after-verification-lands-on-camera.md` — out of scope for that todo, traced but not fixed there.
