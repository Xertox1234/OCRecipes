---
title: "Resolve accessibility followups from broad sweep"
status: done
priority: medium
created: 2026-05-16
updated: 2026-05-16
assignee:
labels: [deferred, accessibility, react-native]
github_issue:
---

# Resolve Accessibility Followups From Broad Sweep

## Summary

Audit findings M11 through M15 and L6 found accessibility issues outside the high-priority modal-root focus trap. Fix the remaining sheet, validation, radio, and disabled-control semantics.

## Background

The broad sweep found several smaller but user-visible accessibility gaps: a bottom sheet without focus trapping, validation error semantics that do not match the project InlineError/assertive pattern, radio controls with wrong or missing state, radio groups without parent `radiogroup`, and disabled Pressables without `accessibilityState.disabled`.

## Acceptance Criteria

- [ ] Add focus trapping semantics to the `RecipeBrowserScreen` filter bottom sheet.
- [ ] Update `SimpleEntrySheet` validation to use invalid state and the project error announcement pattern.
- [ ] Change `BatchSummaryScreen` radio state from `checked` to `selected`.
- [ ] Add missing parent `radiogroup` semantics for verified radio groups.
- [ ] Add selected state to beverage size radio options.
- [ ] Add disabled accessibility state to verified disabled Pressables.
- [ ] Run focused accessibility checks or targeted component tests for touched files.

## Implementation Notes

Relevant files:

- `client/screens/meal-plan/RecipeBrowserScreen.tsx`
- `client/components/meal-plan/SimpleEntrySheet.tsx`
- `client/screens/BatchSummaryScreen.tsx`
- `client/screens/EditDietaryProfileScreen.tsx`
- `client/screens/onboarding/DietTypeScreen.tsx`
- `client/screens/onboarding/PreferencesScreen.tsx`
- `client/components/BeveragePickerSheet.tsx`
- `client/components/InlineMicButton.tsx`
- `client/components/VoiceLogButton.tsx`
- `client/components/HistoryItemActions.tsx`
- `client/components/ParsedFoodPreview.tsx`

Keep this separate from H4, which tracks root modal `accessibilityViewIsModal` on full-screen/modal screens.

## Dependencies

- None known.

## Risks

- Accessibility role/state changes can affect tests that query roles or labels.
- Bottom-sheet focus behavior should be checked on iOS VoiceOver if possible.

## Updates

### 2026-05-16

- Created from broad-sweep audit findings M11, M12, M13, M14, M15, and L6.
