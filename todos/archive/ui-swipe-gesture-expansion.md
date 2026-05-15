---
title: "Expand swipe-to-action gestures to more list screens"
status: done
priority: medium
created: 2026-04-12
updated: 2026-04-12
assignee:
labels: [ui, interaction, ux]
---

# Expand Swipe Gestures

## Summary

Extend the existing `SwipeableRow` component to more list screens for quick actions (delete, favorite, check off). Currently only used in ~13 files.

## Background

`SwipeableRow` (`client/components/SwipeableRow.tsx`) is well-built with left/right actions, haptic feedback, `reducedMotion` fallback (inline buttons), and configurable thresholds. It's used in HistoryScreen and GroceryListScreen but missing from several other list screens.

## Acceptance Criteria

- [ ] MealPlanItems: swipe to delete/reschedule meal plan entries
- [ ] PantryScreen items: swipe to mark as used/expired/delete
- [ ] ChatListScreen conversations: swipe to delete (replace current long-press-only delete)
- [ ] CookbookDetailScreen recipes: swipe to remove from cookbook
- [ ] SavedItemsScreen: swipe to unfavorite/delete
- [ ] All swipe actions show appropriate icons and colors
- [ ] All swipe actions fire haptic feedback
- [ ] `reducedMotion` fallback shows inline action buttons
- [ ] Tests pass

## Implementation Notes

- Use existing `SwipeableRow` component — no new component needed
- Follow the pattern in `HistoryScreen.tsx` (lines 161-175) for right/left action config
- Standard action colors: delete → `theme.error`, favorite → `theme.link`, success → `theme.success`
- Keep long-press as secondary access method for discoverability
- Consider adding a subtle "swipe hint" animation on first visit (progressive disclosure)

## Dependencies

- None — `SwipeableRow` already exists and handles all the interaction logic

## Risks

- Must ensure swipe doesn't conflict with horizontal scroll on screens with horizontal FlatLists
- ChatListScreen needs careful handling — segment control switch should not trigger swipe

## Updates

### 2026-04-12

- Initial creation during UI improvement audit
- ChatListScreen currently uses long-press for delete — swipe would be more discoverable
