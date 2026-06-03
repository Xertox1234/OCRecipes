---
title: "Move accessibilityViewIsModal to inner content View in BeveragePickerSheet"
status: backlog
priority: low
created: 2026-06-03
updated: 2026-06-03
assignee:
labels: [deferred, accessibility]
github_issue:
---

# Move accessibilityViewIsModal to inner content View in BeveragePickerSheet

## Summary

`BeveragePickerSheet` places `accessibilityViewIsModal={true}` on the `BottomSheetModal` wrapper instead of the inner content `View`. The prop must be on the innermost content container; forwarding to a native view is not guaranteed across `@gorhom/bottom-sheet` versions.

## Background

Deferred from 2026-06-03 full audit (L14). File: `client/components/BeveragePickerSheet.tsx:293`.

## Acceptance Criteria

- [ ] `accessibilityViewIsModal={true}` removed from `BottomSheetModal` wrapper
- [ ] `accessibilityViewIsModal={true}` added to the first `View` inside `BottomSheetView` (the content container)
- [ ] VoiceOver focus trapping works correctly in the sheet

## Implementation Notes

Locate the `BottomSheetView` → inner `View` that wraps all sheet content. That View should receive the prop. Test with VoiceOver: focus should not escape the sheet while it's open.

## Dependencies

- None

## Risks

- Low — prop relocation; semantics unchanged

## Updates

### 2026-06-03

- Initial creation (deferred from full audit L14)
