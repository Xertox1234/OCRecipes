---
title: "Bring the remaining small icon buttons to a 44pt tap area without overlapping neighbours"
status: backlog
priority: medium
created: 2026-10-29
updated: 2026-10-29
assignee:
labels: [deferred, accessibility]
github_issue:
---

# Bring the remaining small icon buttons to a 44pt tap area without overlapping neighbours

## Summary

About 20 icon-only buttons still sit below 44pt with `hitSlop={8}`, and a bigger slop is unsafe where a neighbour or the parent card is tappable.

## Background

Audit finding M-a11y-1. The overnight run raised two isolated sites (Pantry delete, Grocery copy-list — commits 119bbe94/b1c4935e) and put three back after review: the grocery pantry-prompt dismiss would overlap the Yes button, and the receipt meal-plan remove and favourites unfavourite would overlap their card's own onPress. Android also clips slop outside a parent shorter than 44pt (grocery title row ~24-28pt). Remaining hitSlop={8} sites: CookSessionReviewScreen:285, ProfileScreen:212, BatchSummaryScreen:485/509/575, MealPlanHomeScreen:748, CookbookDetailScreen:247/356, CookbookListScreen:168, GroceryListsScreen:320, CookbookPickerModal:246, GenerateRecipeDrawer:84, ProfileCard:65, ServingStepperChip:121/173 (adjacent +/−), ChatBubble:105, BeveragePickerSheet:339, GroceryListPickerModal:210, ParsedFoodPreview:62, PresetRecipeRow:112, plus GroceryListScreen:608, ReceiptMealPlanScreen:469, FavouriteRecipesScreen:176.

Found by the 2026-10-29 pre-launch audit (manifest `docs/audits/2026-10-29-pre-launch.md`, local-only); deferred from the unattended overnight run because it needs a decision or verification that run could not make.

## Acceptance Criteria

- [ ] Each site measured (icon + padding + slop) and fixed with a layout change (minWidth/minHeight 44, or row spacing) where a slop would overlap or be clipped
- [ ] No tap target overlaps a sibling or the parent card's onPress
- [ ] Device check on iOS and Android (TalkBack/VoiceOver focus rings show the area)

## Implementation Notes

`docs/solutions/design-patterns/touch-target-size-pattern-2026-05-13.md`. Prefer a 44pt box over slop near other targets.

## Scope Contract

- **Files in scope:** The files listed in Background
- No new mechanisms, files, or abstractions beyond those listed.

## Updates

### 2026-10-29

- Initial creation (pre-launch audit, overnight run)
