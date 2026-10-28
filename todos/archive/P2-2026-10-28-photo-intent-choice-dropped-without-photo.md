---
title: "Home 'Scan Menu' drops the picked option: every PhotoIntent choice opens plain Scan"
status: done
priority: medium
created: 2026-10-28
updated: 2026-10-28
assignee:
labels: [deferred, client, camera]
github_issue:
---

# Home "Scan Menu" drops the picked option

## Summary

Home's "Scan Menu" action (`client/components/home/action-config.ts:26-27`) opens `PhotoIntent` with no `imageUri`. On that screen every option ("Scan restaurant menu", "Find recipes", "Log this meal", …) hits the `if (!imageUri) navigation.navigate("Scan")` branch (`client/screens/PhotoIntentScreen.tsx:125-128`) and the choice is lost. Scan then routes by auto-classification, so:

- "Scan Menu" never reaches the menu scan unless the classifier happens to call the photo a menu.
- The "Find recipes" (premium) path to `PhotoAnalysis` with `intent: "recipe"` — the only way to open `RecipeGenerationModal` — is unreachable: no caller passes `PhotoIntent` an `imageUri`, and Scan sends `raw_ingredients` to Cook & Track (`client/screens/scan-screen-utils.ts:80-84`).

## Background

Found 2026-10-28 while looking for a device route to `RecipeGenerationModal` for the Android modal-toast check (`todos/P3-2026-10-18-modal-toast-host-android-check.md`). Out of scope there.

## Acceptance Criteria

- [ ] Picking an option on `PhotoIntent` without a photo carries the choice through capture (e.g. `navigate("Scan", { intent })`, and Scan routes to that intent's screen after capture instead of auto-classifying), OR the Home action goes straight to the intended flow.
- [ ] "Scan Menu" from Home ends on `MenuScanResult` after a photo.
- [ ] "Find recipes" with a photo reaches `PhotoAnalysis` with `intent: "recipe"` and its Generate Recipe button.
- [ ] Tests cover the no-photo choice being preserved.

## Implementation Notes

- Files: `client/screens/PhotoIntentScreen.tsx`, `client/components/home/action-config.ts`, `client/screens/ScanScreen.tsx`, `client/screens/scan-screen-utils.ts`, `client/navigation/RootStackNavigator.tsx` (`Scan` params), and their tests.
- Deep links may pass `Scan` params through (see `client/navigation/linking.ts`); keep any new param validated.
- Premium lock (`isOptionLocked`) must still run before navigating.
