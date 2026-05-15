---
title: "Remaining major usability issues from full frontend review"
status: backlog
priority: medium
created: 2026-03-24
updated: 2026-03-24
assignee:
labels: [usability, navigation, accessibility, ux]
---

# Remaining Major Usability Issues

## Summary

Full frontend usability review (2026-03-24) found 8 major issues. M7 (error haptics) and M8 (PTR feedback) are resolved. Six remain.

## Review Report

Full report at `.ui-design/reviews/full_frontend_usability_20260324.md`

## Remaining Issues

### M1: Standardize loading state patterns

- Replace full-screen ActivityIndicator with SkeletonLoader on data screens
- Candidates: SavedItemsScreen, RecipeDetailScreen, NutritionDetailScreen, ChatScreen, ItemDetailScreen, EditDietaryProfileScreen, FeaturedRecipeDetailScreen
- Async operation screens (PhotoAnalysis, ReceiptReview, etc.) are fine with ActivityIndicator
- Each screen needs a custom skeleton layout matching its content structure

### M2: Add network/offline state indicator

- No visual indicator when device loses connectivity
- Add `@react-native-community/netinfo` listener + persistent banner when offline
- Show contextual error messages distinguishing network failures from bugs

### M3: Create themed ConfirmationModal for destructive actions

- Remaining destructive confirmations use native `Alert.alert()` (not themed)
- Affected: WeightTrackingScreen, PantryScreen, GroceryListsScreen, FastingScreen (End Fast), ChatListScreen, CookSessionReviewScreen (Remove Ingredient), CookbookDetailScreen, RecipeCreateScreen (Discard), CookSessionCaptureScreen (Discard), BatchScanScreen (Discard)
- Create a themed bottom sheet for routine destructive confirmations

### M4: Implement deep linking for key screens

- `app.json` defines `scheme: "ocrecipes"` but no `linking` config wired to NavigationContainer
- Define path mappings for RecipeDetail, NutritionDetail, Chat
- Enables sharing links and push notification deep links

## Implementation Notes

- M1 needs custom skeleton layouts per screen — significant design work
- M3 is a new reusable component + migration of ~10 Alert.alert confirmations
- M2 and M4 are new features requiring new infrastructure

## Updates

### 2026-03-24

- Initial creation from full frontend usability review
- M7 (error haptics) and M8 (PTR completion feedback) resolved in 53428ef
- M5 (modal stacking) resolved in b2a4b1a — 4 sequential flows fixed
- M6 (error alerts → toast) resolved in 7289b0f — 10 Alert.alert calls migrated
- m1 (CLAUDE.md 5→4 tabs), m2 (hardcoded color), m4 (iOS live region parity) resolved
- Remaining: M1 (skeleton loaders), M2 (offline indicator), M3 (themed confirmations), M4 (deep linking)
