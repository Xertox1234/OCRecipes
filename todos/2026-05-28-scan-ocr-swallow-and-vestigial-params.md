---
title: "ScanScreen STEP-flow swallows OCR errors and passes vestigial params NutritionDetail ignores (latent)"
status: backlog
priority: low
created: 2026-05-28
updated: 2026-05-28
assignee:
labels: [deferred, react-native, camera]
github_issue:
---

# ScanScreen STEP-flow swallows OCR errors and passes vestigial params NutritionDetail ignores (latent)

## Summary

In the multi-step capture flow, `ScanScreen` swallows OCR failures via `if (__DEV__) console.warn(...)` (no production log, no UI) and proceeds with empty `ocrText`. It then navigates to `NutritionDetail` with `localOCRText` / `nutritionImageUri` / `frontLabelImageUri` — **none of which `NutritionDetail` reads**. So the captured OCR/photos are vestigial today, which is the only reason the swallowed error is currently harmless.

## Background

Found during the 2026-05-28 silent-failure investigation. Two coupled latent issues:

1. The swallowed OCR error (`if (__DEV__)` strips all output in production) would become a real silent failure the moment `NutritionDetail` starts consuming `localOCRText`.
2. The STEP flow passes data nothing downstream reads — either it should be wired up or removed as dead params.

Note: the genuine OCR consumer is the **label-mode** path (`ScanScreen:387-394` → `LabelAnalysis`), which sources OCR from `getLatestOCRResult()` (a different source) and is consumed by `LabelAnalysisScreen`. This todo is only about the STEP-flow → NutritionDetail path.

## Acceptance Criteria

- [ ] Decide: should the STEP-flow OCR text / captured photos be consumed by `NutritionDetail` (then handle OCR failure visibly), OR be removed as dead params?
- [ ] If kept/wired-up: the OCR catch no longer silently swallows — failure is surfaced or the empty-text fallback is explicit and intentional.
- [ ] If removed: `localOCRText` / `nutritionImageUri` / `frontLabelImageUri` are dropped from the navigation call and the route param type.

## Implementation Notes

- `client/screens/ScanScreen.tsx:422-428` — catch does `if (__DEV__) console.warn(...)` then proceeds with `ocrText = ""`.
- `client/screens/ScanScreen.tsx:220` and `:241-246` — passes `nutritionImageUri` / `frontLabelImageUri` / `localOCRText` to `NutritionDetail`.
- `client/screens/NutritionDetailScreen.tsx:32-34` (local `RouteParams`) and `:195` — reads only `{ barcode, imageUri, itemId }`; the OCR/photo params are ignored.
- `client/navigation/RootStackNavigator.tsx:73-81` — the `NutritionDetail` param type still declares the unused fields.
- Decision likely needs product input (is server-side OCR enrichment from these photos intended?).

## Dependencies

- None hard. Related to the broader silent-failure cleanup filed 2026-05-28.

## Risks

- Low / latent. Mostly a decision + cleanup; the live behavior doesn't change unless the wire-up option is chosen.

## Updates

### 2026-05-28

- Initial creation. Swallow verified at lines 422-428; param mismatch verified against NutritionDetailScreen route params and the navigator param type.
