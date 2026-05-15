---
title: "Create themed ConfirmationModal for destructive actions"
status: done
priority: low
created: 2026-03-24
updated: 2026-03-25
assignee:
labels: [usability, ux, components]
---

# Create Themed ConfirmationModal for Destructive Actions

## Summary

Replace native `Alert.alert()` destructive confirmations with a themed bottom sheet that matches the app's design language.

## Background

All destructive action confirmations currently use the native `Alert.alert()` dialog, which is not styled to match the app's theme and behaves differently on iOS vs Android. A themed modal would provide a consistent, polished experience.

## Acceptance Criteria

- [ ] Create `ConfirmationModal` component as a themed bottom sheet
- [ ] Props: `visible`, `title`, `message`, `confirmLabel`, `cancelLabel`, `onConfirm`, `onCancel`, `destructive` (boolean)
- [ ] Destructive variant: red confirm button, warning icon
- [ ] Accessible: `accessibilityViewIsModal`, button roles, focus management
- [ ] Respects `reducedMotion` for enter/exit animation
- [ ] Migrate ~10 destructive Alert.alert calls to use the new component

## Screens to Migrate

- WeightTrackingScreen: "Delete Entry"
- PantryScreen: "Remove Item"
- GroceryListsScreen: "Delete List"
- FastingScreen: "End Fast"
- ChatListScreen: "Delete Chat"
- CookSessionReviewScreen: "Remove Ingredient"
- CookbookDetailScreen: "Cookbook Options" (Edit/Delete)
- RecipeCreateScreen: "Discard changes?"
- CookSessionCaptureScreen: "Discard Photos?"
- BatchScanScreen: "Discard scanned items?"

## Implementation Notes

- Use `@gorhom/bottom-sheet` (already in the project) for the sheet presentation
- Reference `SpeedDial.tsx` for `accessibilityViewIsModal` pattern
- The `FastingScreen` "Fast Complete" success alert can stay as native Alert
- `CookbookDetailScreen` "Cookbook Options" is an action sheet (edit/delete), not a simple confirmation — may need a separate pattern

## Dependencies

- `@gorhom/bottom-sheet` (already installed)

## Updates

### 2026-03-24

- Created from full frontend usability review
- Error-only Alert.alert calls already migrated to toast.error in commit 7289b0f
