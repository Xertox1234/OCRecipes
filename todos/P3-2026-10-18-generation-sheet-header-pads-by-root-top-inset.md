---
title: "RecipeGenerationModal pads its header by the root safe-area top inside a pageSheet"
status: backlog
priority: low
created: 2026-10-18
updated: 2026-10-18
assignee:
labels: [deferred, mobile, ui, modal]
github_issue:
---

# RecipeGenerationModal pads its header by the root safe-area top inside a pageSheet

## Summary

`client/components/RecipeGenerationModal.tsx` sets the sheet header's `paddingTop` to `insets.top || Spacing.lg`. Inside a `presentationStyle="pageSheet"` modal the sheet is laid out below the status bar, so the root inset (about 59 pt on an iPhone 17 Pro) adds an empty band above the "Generate Recipe" title. `CookbookPickerModal` and `GroceryListPickerModal` do not pad their headers this way.

## Background

Noticed while fixing the toast's top inset inside the same sheets (follow-up to PR #1503). It is the same bug class: a root safe-area value used inside an RN `Modal` sheet. Cosmetic only. Left out of the toast PR because changing it moves the title up under where the toast now lands, which is a visible design change the owner has not seen.

## Acceptance Criteria

- [ ] The generation sheet's header uses a fixed top padding (`Spacing.lg`, matching the fallback already in the expression) instead of the root top inset.
- [ ] Simulator check: open the sheet and confirm the title sits directly under the sheet's drag area with no status-bar-height gap. Then fire a background "Recipe ready" toast with the sheet open and decide whether the toast overlapping the title row is acceptable (it already is for the two picker sheets and for the root toast over navigation headers).

## Implementation Notes

- One expression at `client/components/RecipeGenerationModal.tsx:142`: `paddingTop: insets.top || Spacing.lg` becomes `paddingTop: Spacing.lg`. Keep `insets.bottom` on the scroll content; the sheet does reach the bottom edge.
- Nothing else in the file reads `insets.top`.

## Scope Contract

- **Mechanisms to use:** the existing `Spacing` tokens; nothing new.
- **Files in scope:** `client/components/RecipeGenerationModal.tsx`.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None.

## Risks

- On Android, `insets.top` is already 0 in this position, so the fallback is what renders today; the change is iOS-only in effect.

## Updates

### 2026-10-18

- Initial creation.
