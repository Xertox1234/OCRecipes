---
title: "Add Platform.OS announce-gating test for BeveragePickerSheet (H4)"
status: done
priority: low
created: 2026-06-03
updated: 2026-06-03
assignee:
labels: [deferred, testing, accessibility]
github_issue:
---

# Add Platform.OS announce-gating test for BeveragePickerSheet (H4)

## Summary

Add a render test asserting that `BeveragePickerSheet`'s error `AccessibilityInfo.announceForAccessibility` is gated to `Platform.OS === "ios"` (and that the error `View` carries `accessibilityLiveRegion="assertive"` for Android), matching the pattern already tested in CoachChat, CoachHint, and UpgradeModal.

## Background

The 2026-06-03 full audit (PR #344) added the iOS-gated announce + Android live-region split to four components. Three got regression tests (`CoachChat`, `CoachHint`, `UpgradeModal`); `BeveragePickerSheet` (H4) was deferred because its `error` state is internal and only reachable by driving a multi-step `BottomSheetModal` flow, making a render test the most involved of the four. The identical gating pattern is already locked in by the other three tests, so the marginal coverage value is low — hence low priority.

## Acceptance Criteria

- [ ] On iOS, setting an error announces it via `AccessibilityInfo.announceForAccessibility`
- [ ] On Android, the same error does NOT call `announceForAccessibility` (the error `View`'s `accessibilityLiveRegion="assertive"` handles it)
- [ ] Test uses the established harness: `// @vitest-environment jsdom`, `renderComponent`, `RN.Platform.OS` mutate-and-restore, `vi.spyOn(RN.AccessibilityInfo, "announceForAccessibility")`

## Implementation Notes

- File: `client/components/__tests__/BeveragePickerSheet.test.tsx` (new).
- Source under test: `client/components/BeveragePickerSheet.tsx` — announce effect ~line 84; error `View` with `accessibilityLiveRegion="assertive"` ~line 356.
- The cheapest error to trigger is the synchronous custom-calorie validation (`setError("Calories must be between 0 and ...")`, ~line 173) rather than the network path (~line 215, needs an `apiRequest` mock). Reaching it still requires: present the sheet (`sheetRef.present()`), select the `"custom"` beverage, enter an out-of-range calorie value, and submit.
- `@gorhom/bottom-sheet` is already aliased to `test/mocks/gorhom-bottom-sheet.ts`; confirm `BottomSheetModal` renders its children in the mock (it may gate on `present()`), or drive/stub the ref accordingly.
- Pattern reference: `client/components/__tests__/UpgradeModal.test.tsx` and `client/components/coach/__tests__/CoachChat.test.tsx` (the "announce gating" describe blocks).
- If the bottom-sheet flow proves too brittle, an acceptable alternative is extracting the announce gate into a small tested helper (e.g. `announceIfIOS(message)`) shared by all four components.

## Dependencies

- None (harness + pattern already exist as of PR #344).

## Risks

- Driving the `BottomSheetModal` flow in jsdom may be brittle depending on how the gorhom mock renders presented content.

## Updates

### 2026-06-03

- Initial creation — deferred from PR #344 (full-audit a11y test coverage). Other three components (C1/H2/H3) tested in that PR.
