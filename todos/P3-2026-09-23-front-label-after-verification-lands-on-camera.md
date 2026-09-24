---
title: "Front-label scan started after a verification returns to the label camera"
status: in-progress
priority: low
created: 2026-09-23
updated: 2026-09-23
assignee:
labels: [deferred, client]
github_issue:
---

# Front-label scan started after a verification returns to the label camera

## Summary

After a successful label verification, LabelAnalysis offers "Scan Front Label". Finishing that flow drops the user on the live label camera instead of back on the product.

## Background

Found by two reviewers of PR #1029 (pre-existing, outside that PR's diff). The verification stack is `NutritionDetail → Scan(label) → LabelAnalysis`. The front-label CTA in `LabelAnalysisScreen.tsx` calls `navigation.replace("Scan", { mode: "front-label", verifyBarcode })`, giving `NutritionDetail → Scan(label) → Scan(front-label)`. After FrontLabelConfirm saves, its `navigation.pop(2)` returns to `Scan(label)`, whose camera goes live again. The user has to close it a second time. #1028 made this path reachable again, and #1029 fixed the same kind of bug for LabelAnalysis's own "Done" button.

## Acceptance Criteria

- [ ] After verify → "Scan Front Label" → confirm, the user lands on NutritionDetail (or on LabelAnalysis's result, if that is the chosen design), never on a live camera.
- [ ] FrontLabelConfirm's other entry, NutritionDetail's "Add product details", still returns to NutritionDetail.
- [ ] A render test pins the navigation call for the LabelAnalysis entry.

## Implementation Notes

- One option: push instead of replace (`navigation.navigate("Scan", …)`). FrontLabelConfirm's `pop(2)` then returns to LabelAnalysis, where the verification result and Done (`pop(2)` → NutritionDetail) are still shown. Check that the front-label CTA hides once front-label data exists.
- Files: `client/screens/LabelAnalysisScreen.tsx` (front-label CTA), `client/screens/FrontLabelConfirmScreen.tsx` (`pop(2)` on success), `client/screens/__tests__/LabelAnalysisScreen.verification.test.tsx`.

## Updates

### 2026-09-23

- Filed from PR #1029 review.
