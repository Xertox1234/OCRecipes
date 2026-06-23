---
title: "Menu activation follow-ups: per-feature smart-scan gate + forward localOCRText"
status: done
priority: low
created: 2026-06-22
updated: 2026-06-22
assignee:
labels: [deferred, rn-ui-ux]
github_issue:
---

# Menu activation follow-ups (from PR #432 review)

## Summary

Two non-blocking enhancements to the scan flow surfaced in the PR #432 ("activate orphaned menu scanner") review. Neither is a live bug today; both are tracked here rather than bundled into the prod-deploying activation PR.

## Background

PR #432 re-wired restaurant menus to the dedicated `MenuScanResultScreen`. Review found two minor scan-flow gaps.

## Acceptance Criteria

- [ ] **Per-feature smart-scan premium gate.** `ScanScreen.onSmartPhotoConfirm` gates via `getPremiumGate(contentType) && !isPremium` (blanket "any premium"), while the manual picker (`PhotoIntentScreen` → `isIntentOptionLocked`) gates on the _specific_ feature flag. Make smart-scan gate on the specific feature too (`!features[gate.feature]`). NOTE: behaviorally inert today — the only premium tier already includes every gated feature (`menuScanner`, `cookAndTrack`, `receiptScanner`), and the server endpoints enforce the feature regardless. This is future-proofing for a partial-premium tier.
- [ ] **Forward `localOCRText` to MenuScanResult from the smart-scan path.** The smart-scan flow already computes `localOCRText` (`ScanScreen.tsx:366-378`), and `MenuScanResultScreen` uses it for an instant local-skeleton (the OCR race-swap). `getRouteForContentType` currently routes menus with only `{ imageUri }`, so the smart-scan menu path loses that head-start. Thread `localOCRText` through `getRouteForContentType`'s `restaurant_menu` case (and update its unit test).

## Implementation Notes

- Gate: `ScanScreen.tsx:663-667`. `usePremiumContext()` exposes `features` (currently only `refreshScanCount` is destructured at line 91). `getPremiumGate` returns `{ feature: string; label }` — `gate.feature` must be narrowed to `keyof PremiumFeatures` (adjust the `PREMIUM_GATES` type in `scan-screen-utils.ts`) to index `features[gate.feature]` without a cast.
- OCR forward: `client/screens/scan-screen-utils.ts` `getRouteForContentType` signature + the `restaurant_menu` case; caller at `ScanScreen.tsx:668`; test at `client/screens/__tests__/scan-screen-utils.test.ts`.

## Dependencies

- Follows PR #432 (menu activation). No blocking dependency once #432 merges.
