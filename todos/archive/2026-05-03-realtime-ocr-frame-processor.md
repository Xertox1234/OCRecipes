---
title: "Realtime OCR Frame Processor"
status: in-progress
priority: high
created: 2026-05-03
updated: 2026-05-03
assignee:
labels: [camera, performance, deferred]
---

# Realtime OCR Frame Processor

## Summary

Add on-device MLKit OCR via a VisionCamera frame processor to camera label mode, giving users instant "text detected" feedback and a local nutrition preview — reducing OpenAI Vision round-trips and their associated latency (~2-4s) and cost.

## Background

All text extraction (nutrition labels, menus, front-of-package) currently round-trips to OpenAI Vision. For clearly printed nutrition labels, on-device OCR can extract the data locally and instantly. This was identified in the camera audit as the highest-value camera improvement.

Full design and implementation plan already written:

- **Spec:** `docs/superpowers/specs/2026-04-07-realtime-ocr-frame-processor-design.md`
- **Plan:** `docs/superpowers/plans/2026-04-07-realtime-ocr-frame-processor.md`

## Acceptance Criteria

- [ ] `react-native-vision-camera-ocr-plus` installed and linked (MLKit frame processor plugin)
- [ ] `useOCRDetection` hook debounces frame processor output and exposes `textDetected: boolean`
- [ ] Corner glow animation on `ScanScreen` when text is detected in label mode
- [ ] Cached OCR text passed as `localOCRText` route param to `LabelAnalysisScreen`
- [ ] `LabelAnalysisScreen` shows instant local nutrition preview; OpenAI runs in background and merges/replaces on completion
- [ ] Frame processor only active in label scan mode (not barcode mode) to conserve battery
- [ ] iOS simulator MLKit arm64 fix applied (Podfile hook — see `project_ios26_simulator_fix.md` memory)

## Implementation Notes

The spec and plan are detailed and ready to execute. Key architectural decisions already made:

- **Library:** `react-native-vision-camera-ocr-plus` (purpose-built frame processor, native 30fps)
- **UX feedback:** Passive corner glow (no new UI elements — extends existing corner animation)
- **OpenAI interaction:** Local preview first, OpenAI confirms in background
- **Active modes:** Label mode only (frame processors have CPU/battery cost)
- **Frame skip:** Every 10th frame via `frameSkipThreshold` to reduce CPU load

The `NutritionDetail` route params in `RootStackNavigator.tsx` already have `localOCRText?` added (from the premium scan flow plan) — confirm this is still present before starting.

## Dependencies

- `react-native-vision-camera-ocr-plus` npm package
- MLKit native libraries (already partially present from the iOS 26 simulator fix)
- Must run `npx expo run:ios` (not Expo Go) — native module

## Risks

- MLKit fat binary / simulator arm64 issue — already handled by Podfile hook, but verify after adding the new package
- Frame processor worklet threading — OCR results must cross to JS thread via `Worklets.createRunInJsFn`
- OpenAI merge logic edge cases (local OCR misreads a field that OpenAI corrects)

## Updates

### 2026-05-03

- Initial creation — identified as the only unimplemented spec/plan in the superpowers backlog
