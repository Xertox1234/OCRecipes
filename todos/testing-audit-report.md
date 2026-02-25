# NutriScan Comprehensive Testing Audit Report

**Date:** 2025-02-25 (Updated: 2025-07-17)
**Workspace:** `/Users/williamtower/projects/Nutri-Cam`

---

## Executive Summary

| Category | Source Files | Tested | Coverage % |
|---|---|---|---|
| Server Routes | 24 | 24 | **100%** |
| Server Services | 22 | 22 | **100%** |
| Server Utils | 2 | 2 | **100%** |
| Server Lib | 3 | 2 | 66.7% |
| Server Middleware | 1 | 1* | **100%*** |
| Server Storage | 12 | 1* | 8.3% |
| Client Lib | 16 | 14 | 87.5% |
| Client Hooks | 29 | 2 | 6.9% |
| Client Context | 4 | 3 | 75.0% |
| Client Components | 48 | 1 | 2.1% |
| Client Camera | 5 | 2 | 40.0% |
| Shared | 17 | 5 | 29.4% |
| Client Screens | 31 | 0 | 0% |
| **TOTAL** | **214** | **79** | **36.9%** |

*\* Server middleware `auth.ts` is tested via `server/__tests__/auth.test.ts`. Storage has a general `server/__tests__/storage.test.ts` covering the storage interface.*

---

## 1. Server Routes (`server/routes/`)

**Source files: 24 | Tested: 24 | Coverage: 100%** ✅

All files export runtime code (Express route handlers).

| Source File | Lines | Test File | Status |
|---|---|---|---|
| `_helpers.ts` | 301 | `__tests__/_helpers.test.ts` | ✅ Tested |
| `adaptive-goals.ts` | 197 | `__tests__/adaptive-goals.test.ts` | ✅ Tested |
| `auth.ts` | 254 | `__tests__/auth.test.ts` | ✅ Tested |
| `chat.ts` | 215 | `__tests__/chat.test.ts` | ✅ Tested |
| `exercises.ts` | 284 | `__tests__/exercises.test.ts` | ✅ Tested |
| `fasting.ts` | 162 | `__tests__/fasting.test.ts` | ✅ Tested |
| `food.ts` | 105 | `__tests__/food.test.ts` | ✅ Tested |
| `goals.ts` | 137 | `__tests__/goals.test.ts` | ✅ Tested |
| `grocery.ts` | 397 | `__tests__/grocery.test.ts` | ✅ Tested |
| `healthkit.ts` | 135 | `__tests__/healthkit.test.ts` | ✅ Tested |
| `meal-plan.ts` | 416 | `__tests__/meal-plan.test.ts` | ✅ Tested |
| `meal-suggestions.ts` | 191 | `__tests__/meal-suggestions.test.ts` | ✅ Tested |
| `medication.ts` | 372 | `__tests__/medication.test.ts` | ✅ Tested |
| `menu.ts` | 105 | `__tests__/menu.test.ts` | ✅ Tested |
| `micronutrients.ts` | 106 | `__tests__/micronutrients.test.ts` | ✅ Tested |
| `nutrition.ts` | 343 | `__tests__/nutrition.test.ts` | ✅ Tested |
| `pantry.ts` | 200 | `__tests__/pantry.test.ts` | ✅ Tested |
| `photos.ts` | 314 | `__tests__/photos.test.ts` | ✅ Tested |
| `profile.ts` | 135 | `__tests__/profile.test.ts` | ✅ Tested |
| `recipes.ts` | 558 | `__tests__/recipes.test.ts` | ✅ Tested |
| `saved-items.ts` | 88 | `__tests__/saved-items.test.ts` | ✅ Tested |
| `subscription.ts` | 186 | `__tests__/subscription.test.ts` | ✅ Tested |
| `suggestions.ts` | 302 | `__tests__/suggestions.test.ts` | ✅ Tested |
| `weight.ts` | 156 | `__tests__/weight.test.ts` | ✅ Tested |

**All 24 route files now have test coverage.** ✅

---

## 2. Server Services (`server/services/`)

**Source files: 22 | Tested: 22 | Coverage: 100%** ✅

| Source File | Lines | Test File | Status |
|---|---|---|---|
| `adaptive-goals.ts` | 206 | `__tests__/adaptive-goals.test.ts` | ✅ |
| `cultural-food-map.ts` | 540 | `__tests__/cultural-food-map.test.ts` | ✅ |
| `exercise-calorie.ts` | 12 | `__tests__/exercise-calorie.test.ts` | ✅ |
| `fasting-stats.ts` | 74 | `__tests__/fasting-stats.test.ts` | ✅ |
| `food-nlp.ts` | 109 | `__tests__/food-nlp.test.ts` | ✅ |
| `glp1-insights.ts` | 112 | `__tests__/glp1-insights.test.ts` | ✅ |
| `goal-calculator.ts` | 137 | `__tests__/goal-calculator.test.ts` | ✅ |
| `grocery-generation.ts` | 302 | `__tests__/grocery-generation.test.ts` | ✅ |
| `healthkit-sync.ts` | 69 | `__tests__/healthkit-sync.test.ts` | ✅ |
| `meal-suggestions.ts` | 174 | `__tests__/meal-suggestions.test.ts` | ✅ |
| `menu-analysis.ts` | 146 | `__tests__/menu-analysis.test.ts` | ✅ |
| `micronutrient-lookup.ts` | 208 | `__tests__/micronutrient-lookup.test.ts` | ✅ |
| `nutrition-coach.ts` | 119 | `__tests__/nutrition-coach.test.ts` | ✅ |
| `nutrition-lookup.ts` | 1086 | `__tests__/nutrition-lookup.test.ts` | ✅ |
| `pantry-deduction.ts` | 63 | `__tests__/pantry-deduction.test.ts` | ✅ |
| `photo-analysis.ts` | 291 | `__tests__/photo-analysis.test.ts` | ✅ |
| `receipt-validation.ts` | 367 | `__tests__/receipt-validation.test.ts` | ✅ |
| `recipe-catalog.ts` | 287 | `__tests__/recipe-catalog.test.ts` | ✅ |
| `recipe-generation.ts` | 221 | `__tests__/recipe-generation.test.ts` | ✅ |
| `recipe-import.ts` | 526 | `__tests__/recipe-import.test.ts` | ✅ |
| `voice-transcription.ts` | 20 | `__tests__/voice-transcription.test.ts` | ✅ |
| `weight-trend.ts` | 93 | `__tests__/weight-trend.test.ts` | ✅ |

---

## 3. Server Utils (`server/utils/`)

**Source files: 2 | Tested: 2 | Coverage: 100%** ✅

| Source File | Lines | Test File | Status |
|---|---|---|---|
| `date-validation.ts` | 14 | `__tests__/date-validation.test.ts` | ✅ |
| `profile-hash.ts` | 16 | `__tests__/profile-hash.test.ts` | ✅ |

---

## 4. Server Lib (`server/lib/`)

**Source files: 3 | Tested: 2 | Coverage: 66.7%**

| Source File | Lines | Test File | Status | Testable? |
|---|---|---|---|---|
| `ai-safety.ts` | 126 | `__tests__/ai-safety.test.ts` | ✅ | Yes |
| `api-errors.ts` | 20 | `__tests__/api-errors.test.ts` | ✅ | Yes |
| `openai.ts` | 11 | — | ❌ **UNTESTED** | Minimal — exports OpenAI client instance |

**Untested: 1 file, 11 lines.** Low priority — `openai.ts` is a thin wrapper exporting an OpenAI client instance.

---

## 5. Server Middleware (`server/middleware/`)

**Source files: 1 | Tested: 1 | Coverage: 100%** ✅

| Source File | Lines | Test File | Status |
|---|---|---|---|
| `auth.ts` | 122 | `server/__tests__/auth.test.ts` | ✅ |

---

## 6. Server Storage (`server/storage/`)

**Source files: 12 | Tested: 1 (general) | Coverage: 8.3%**

All files export runtime code (database query functions). One general storage test exists at `server/__tests__/storage.test.ts` (19,269 lines) which tests the storage interface, but no per-file unit tests exist.

| Source File | Lines | Dedicated Test? | Status |
|---|---|---|---|
| `activity.ts` | 234 | — | ⚠️ General test only |
| `cache.ts` | 225 | — | ⚠️ General test only |
| `chat.ts` | 139 | — | ⚠️ General test only |
| `community.ts` | 166 | — | ⚠️ General test only |
| `fasting.ts` | 84 | — | ⚠️ General test only |
| `helpers.ts` | 19 | — | ⚠️ General test only |
| `index.ts` | 160 | — | ⚠️ General test only |
| `meal-plans.ts` | 663 | — | ⚠️ General test only |
| `medication.ts` | 83 | — | ⚠️ General test only |
| `menu.ts` | 35 | — | ⚠️ General test only |
| `nutrition.ts` | 379 | — | ⚠️ General test only |
| `users.ts` | 152 | — | ⚠️ General test only |

**Note:** The general `storage.test.ts` at 19K lines likely provides broad coverage of the storage interface. Individual unit tests per storage module are not present.

---

## 7. Client Lib (`client/lib/`)

**Source files: 16 | Tested: 14 | Coverage: 87.5%**

### Root (`client/lib/`)

| Source File | Lines | Test File | Status | Testable? |
|---|---|---|---|---|
| `api-error.ts` | 12 | `__tests__/api-error.test.ts` | ✅ | Yes |
| `format.ts` | 61 | `__tests__/format.test.ts` | ✅ | Yes |
| `healthkit.ts` | 50 | — | ❌ **UNTESTED** | Yes (6 exports) |
| `image-compression.ts` | 86 | — | ❌ **UNTESTED** | Yes (4 exports) |
| `ingredient-parser.ts` | 71 | `__tests__/ingredient-parser.test.ts` | ✅ | Yes |
| `macro-colors.ts` | 33 | `__tests__/macro-colors.test.ts` | ✅ | Yes |
| `photo-upload.ts` | 220 | `__tests__/photo-upload.test.ts` | ✅ | Yes |
| `query-client.ts` | 116 | `__tests__/query-client.test.ts` | ✅ | Yes |
| `serving-size-utils.ts` | 552 | `__tests__/serving-size-utils.test.ts` | ✅ | Yes |
| `token-storage.ts` | 43 | `__tests__/token-storage.test.ts` | ✅ | Yes |

### IAP (`client/lib/iap/`)

| Source File | Lines | Test File | Status | Testable? |
|---|---|---|---|---|
| `constants.ts` | 15 | — | Not separately tested | Yes (constants) |
| `index.ts` | 33 | — | Not separately tested | Re-export barrel |
| `mock-iap.ts` | 47 | — | Not separately tested | Test helper |
| `purchase-utils.ts` | 75 | `__tests__/purchase-utils.test.ts` | ✅ | Yes |
| `types.ts` | 21 | — | N/A | Pure types |
| `usePurchase.ts` | 118 | `__tests__/usePurchase.test.ts` | ✅ | Yes (hook) |

### Subscription (`client/lib/subscription/`)

| Source File | Lines | Test File | Status | Testable? |
|---|---|---|---|---|
| `query-keys.ts` | 6 | `__tests__/query-keys.test.ts` | ✅ | Yes |
| `type-guards.ts` | 21 | `__tests__/type-guards.test.ts` | ✅ | Yes |

**Untested: 2 runtime files — `healthkit.ts` (50 lines), `image-compression.ts` (86 lines) = 136 lines**

---

## 8. Client Hooks (`client/hooks/`)

**Source files: 29 | Tested: 2 | Coverage: 6.9%**

All hooks export runtime code (React hooks).

| Source File | Lines | Test File | Status |
|---|---|---|---|
| `useAccessibility.ts` | 14 | — | ❌ **UNTESTED** |
| `useAdaptiveGoals.ts` | 56 | — | ❌ **UNTESTED** |
| `useAuth.ts` | 127 | — | ❌ **UNTESTED** |
| `useChat.ts` | 153 | — | ❌ **UNTESTED** |
| `useColorScheme.ts` | 1 | — | ❌ **UNTESTED** (re-export, trivial) |
| `useDailyBudget.ts` | 18 | — | ❌ **UNTESTED** |
| `useDiscardItem.ts` | 61 | — | ❌ **UNTESTED** |
| `useExerciseLogs.ts` | 73 | — | ❌ **UNTESTED** |
| `useFasting.ts` | 79 | — | ❌ **UNTESTED** |
| `useFavourites.ts` | 61 | — | ❌ **UNTESTED** |
| `useFoodParse.ts` | 57 | — | ❌ **UNTESTED** |
| `useGroceryList.ts` | 212 | — | ❌ **UNTESTED** |
| `useHaptics.ts` | 48 | — | ❌ **UNTESTED** |
| `useHealthKit.ts` | 65 | — | ❌ **UNTESTED** |
| `useMealPlan.ts` | 97 | — | ❌ **UNTESTED** |
| `useMealPlanRecipes.ts` | 185 | — | ❌ **UNTESTED** |
| `useMealSuggestions.ts` | 20 | — | ❌ **UNTESTED** |
| `useMedication.ts` | 53 | — | ❌ **UNTESTED** |
| `useMenuScan.ts` | 51 | — | ❌ **UNTESTED** |
| `useMicronutrients.ts` | 42 | — | ❌ **UNTESTED** |
| `usePantry.ts` | 98 | — | ❌ **UNTESTED** |
| `usePremiumFeatures.ts` | 99 | `__tests__/usePremiumFeatures.test.ts` | ✅ Tested |
| `useRecipeForm.ts` | 304 | `__tests__/useRecipeForm.test.ts` | ✅ Tested |
| `useSavedItems.ts` | 87 | — | ❌ **UNTESTED** |
| `useScreenOptions.ts` | 35 | — | ❌ **UNTESTED** |
| `useSuggestionInstructions.ts` | 46 | — | ❌ **UNTESTED** |
| `useTheme.ts` | 47 | — | ❌ **UNTESTED** |
| `useVoiceRecording.ts` | 60 | — | ❌ **UNTESTED** |
| `useWeightLogs.ts` | 73 | — | ❌ **UNTESTED** |

**Untested: 27 hooks, 1,919 lines of runtime code**

Priority untested hooks (by line count):
1. `useRecipeForm.ts` is tested ✅
2. `useGroceryList.ts` — 212 lines
3. `useMealPlanRecipes.ts` — 185 lines
4. `useChat.ts` — 153 lines
5. `useAuth.ts` — 127 lines

---

## 9. Client Context (`client/context/`)

**Source files: 4 | Tested: 3 | Coverage: 75.0%**

| Source File | Lines | Test File | Status | Testable? |
|---|---|---|---|---|
| `AuthContext.tsx` | 30 | `__tests__/AuthContext.test.ts` | ✅ | Yes |
| `OnboardingContext.tsx` | 118 | `__tests__/OnboardingContext.test.ts` | ✅ | Yes |
| `PremiumContext.tsx` | 147 | `__tests__/PremiumContext.test.ts` | ✅ | Yes |
| `ThemeContext.tsx` | 100 | — | ❌ **UNTESTED** | Yes |

**Untested: 1 file, 100 lines**

---

## 10. Client Components (`client/components/`)

**Source files: 48 (40 root .tsx + 1 root .ts + 7 recipe-builder .tsx) | Tested: 1 | Coverage: 2.1%**

### Root Components (41 files: 40 .tsx + 1 .ts)

| Source File | Lines | Test File | Status |
|---|---|---|---|
| `AdaptiveGoalCard.tsx` | 384 | — | ❌ |
| `AppetiteTracker.tsx` | 94 | — | ❌ |
| `Button.tsx` | 160 | — | ❌ |
| `CalorieBudgetBar.tsx` | 124 | — | ❌ |
| `Card.tsx` | 267 | — | ❌ |
| `ChatBubble.tsx` | 183 | — | ❌ |
| `Chip.tsx` | 207 | — | ❌ |
| `CuisineTag.tsx` | 69 | — | ❌ |
| `ErrorBoundary.tsx` | 54 | — | ❌ |
| `ErrorFallback.tsx` | 258 | — | ❌ |
| `FastingSetupModal.tsx` | 440 | — | ❌ |
| `FastingStreakBadge.tsx` | 94 | — | ❌ |
| `FastingTimer.tsx` | 171 | — | ❌ |
| `GroceryListPickerModal.tsx` | 405 | — | ❌ |
| `HeaderTitle.tsx` | 42 | — | ❌ |
| `HealthKitSyncIndicator.tsx` | 85 | — | ❌ |
| `HighProteinSuggestions.tsx` | 127 | — | ❌ |
| `HistoryItemActions.tsx` | 186 | — | ❌ |
| `HomeRecipeCard.tsx` | 157 | — | ❌ |
| `KeyboardAwareScrollViewCompat.tsx` | 22 | — | ❌ |
| `MealSuggestionsModal.tsx` | 400 | — | ❌ |
| `MedicationLogCard.tsx` | 131 | — | ❌ |
| `MicronutrientBar.tsx` | 82 | — | ❌ |
| `MicronutrientSummary.tsx` | 209 | — | ❌ |
| `ParsedFoodPreview.tsx` | 121 | — | ❌ |
| `PreparationPicker.tsx` | 89 | — | ❌ |
| `ProgressBar.tsx` | 74 | — | ❌ |
| `RecipeGenerationModal.tsx` | 636 | — | ❌ |
| `SaveButton.tsx` | 159 | — | ❌ |
| `SavedItemCard.tsx` | 235 | — | ❌ |
| `ScanFAB.tsx` | 83 | — | ❌ |
| `SkeletonLoader.tsx` | 163 | — | ❌ |
| `SuggestionCard.tsx` | 458 | — | ❌ |
| `TextInput.tsx` | 151 | — | ❌ |
| `ThemedText.tsx` | 74 | — | ❌ |
| `ThemedView.tsx` | 26 | — | ❌ |
| `TrendingTags.tsx` | 65 | — | ❌ |
| `upgrade-modal-utils.ts` | 34 | — | ❌ (runtime util) |
| `UpgradeModal.tsx` | 353 | `__tests__/UpgradeModal.test.ts` | ✅ Tested |
| `VoiceLogButton.tsx` | 75 | — | ❌ |
| `WeightChart.tsx` | 166 | — | ❌ |

### Recipe Builder Components (7 .tsx files)

| Source File | Lines | Test File | Status |
|---|---|---|---|
| `IngredientsSheet.tsx` | 180 | — | ❌ |
| `InstructionsSheet.tsx` | 266 | — | ❌ |
| `NutritionSheet.tsx` | 141 | — | ❌ |
| `SectionRow.tsx` | 140 | — | ❌ |
| `SheetHeader.tsx` | 71 | — | ❌ |
| `TagsCuisineSheet.tsx` | 151 | — | ❌ |
| `TimeServingsSheet.tsx` | 213 | — | ❌ |

*(recipe-builder `types.ts` (33 lines) excluded — contains 1 runtime export but is mostly types)*

**Untested: 47 component files, ~8,474 lines of runtime UI code**

Priority untested components (by line count):
1. `RecipeGenerationModal.tsx` — 636 lines
2. `SuggestionCard.tsx` — 458 lines
3. `FastingSetupModal.tsx` — 440 lines
4. `GroceryListPickerModal.tsx` — 405 lines
5. `MealSuggestionsModal.tsx` — 400 lines
6. `AdaptiveGoalCard.tsx` — 384 lines

---

## 11. Client Camera (`client/camera/`)

**Source files: 5 | Tested: 2 | Coverage: 40.0%**

| Source File | Lines | Test File | Status | Testable? |
|---|---|---|---|---|
| `index.ts` | 9 | — | N/A | Re-export barrel |
| `types.ts` | 53 | — | N/A | Pure types |
| `components/CameraView.tsx` | 204 | — | ❌ **UNTESTED** | Yes (RN component) |
| `hooks/useCamera.ts` | 102 | `hooks/__tests__/useCamera.test.ts` | ✅ | Yes |
| `hooks/useCameraPermissions.ts` | 84 | `hooks/__tests__/useCameraPermissions.test.ts` | ✅ | Yes |

**Untested runtime files: 1 (`CameraView.tsx`, 204 lines)** — but 2 pure-type/barrel files are untestable.

---

## 12. Shared (`shared/`)

**Source files: 17 | Tested: 5 | Coverage: 29.4%**

| Source File | Lines | Test File | Status | Testable? |
|---|---|---|---|---|
| `schema.ts` | 1360 | `__tests__/schema.test.ts` | ✅ | Yes (Drizzle tables) |
| **schemas/** | | | | |
| `schemas/saved-items.ts` | 17 | `schemas/__tests__/saved-items.test.ts` | ✅ | Yes (Zod schemas) |
| `schemas/subscription.ts` | 34 | `schemas/__tests__/subscription.test.ts` | ✅ | Yes (Zod schemas) |
| **types/** | | | | |
| `types/auth.ts` | 41 | `__tests__/auth-types.test.ts` | ✅ | Yes (1 runtime export + types) |
| `types/camera.ts` | 134 | `__tests__/camera.test.ts` | ✅ | Yes (9 runtime exports) |
| `types/exercise.ts` | 40 | — | ❌ | **No** (pure types/interfaces) |
| `types/fasting.ts` | 40 | — | ❌ | **No** (pure types/interfaces) |
| `types/meal-plan.ts` | 6 | — | ❌ | **No** (pure types) |
| `types/meal-suggestions.ts` | 19 | — | ❌ | **No** (pure types) |
| `types/medication.ts` | 31 | — | ❌ | **No** (pure types) |
| `types/premium.ts` | 113 | `__tests__/premium.test.ts` | ✅* | Yes (5 runtime exports) |
| `types/protein-suggestions.ts` | 13 | — | ❌ | **No** (pure types) |
| `types/recipe-catalog.ts` | 23 | — | ❌ | **No** (pure types) |
| `types/recipe-import.ts` | 23 | — | ❌ | **No** (pure types) |
| `types/subscription.ts` | 19 | `__tests__/subscription-types.test.ts` | ✅ | Mostly types |
| `types/weight.ts` | 27 | — | ❌ | **No** (pure types) |
| **constants/** | | | | |
| `constants/preparation.ts` | 108 | `constants/__tests__/preparation.test.ts` | ✅ | Yes (7 runtime exports) |

*\* `premium.test.ts` found in `shared/__tests__/` — assumed to test `types/premium.ts`.*

**Untested with runtime code: 0** — All untested shared files are pure types/interfaces with no runtime exports.

**Effective coverage for testable shared code: ~100%** (all files with runtime exports have tests).

---

## 13. Client Screens (`client/screens/`)

**Source files: 31 | Tested: 0 | Coverage: 0%**

All screens export React components (runtime code).

### Root Screens (23 files)

| Source File | Lines |
|---|---|
| `ChatListScreen.tsx` | 342 |
| `ChatScreen.tsx` | 435 |
| `EditDietaryProfileScreen.tsx` | 819 |
| `ExerciseLogScreen.tsx` | 517 |
| `ExerciseSearchScreen.tsx` | 202 |
| `FastingScreen.tsx` | 820 |
| `FeaturedRecipeDetailScreen.tsx` | 292 |
| `GLP1CompanionScreen.tsx` | 613 |
| `GoalSetupScreen.tsx` | 767 |
| `HealthKitSettingsScreen.tsx` | 429 |
| `HistoryScreen.tsx` | 1158 |
| `HomeScreen.tsx` | 444 |
| `ItemDetailScreen.tsx` | 294 |
| `LoginScreen.tsx` | 285 |
| `MenuScanResultScreen.tsx` | 330 |
| `NutritionDetailScreen.tsx` | 1158 |
| `PhotoAnalysisScreen.tsx` | 1137 |
| `PhotoIntentScreen.tsx` | 253 |
| `ProfileScreen.tsx` | 1070 |
| `QuickLogScreen.tsx` | 359 |
| `SavedItemsScreen.tsx` | 201 |
| `ScanScreen.tsx` | 604 |
| `WeightTrackingScreen.tsx` | 466 |

### Meal Plan Screens (8 files)

| Source File | Lines |
|---|---|
| `meal-plan/GroceryListScreen.tsx` | 552 |
| `meal-plan/GroceryListsScreen.tsx` | 376 |
| `meal-plan/MealPlanHomeScreen.tsx` | 1114 |
| `meal-plan/PantryScreen.tsx` | 442 |
| `meal-plan/RecipeBrowserScreen.tsx` | 876 |
| `meal-plan/RecipeCreateScreen.tsx` | 494 |
| `meal-plan/RecipeDetailScreen.tsx` | 383 |
| `meal-plan/RecipeImportScreen.tsx` | 372 |

### Onboarding Screens (6 files)

| Source File | Lines |
|---|---|
| `onboarding/AllergiesScreen.tsx` | 318 |
| `onboarding/DietTypeScreen.tsx` | 293 |
| `onboarding/GoalsScreen.tsx` | 348 |
| `onboarding/HealthConditionsScreen.tsx` | 308 |
| `onboarding/PreferencesScreen.tsx` | 391 |
| `onboarding/WelcomeScreen.tsx` | 206 |

**All 31 screens untested: 19,468 lines total**

---

## Overall Summary

### By the Numbers

| Metric | Value |
|---|---|
| **Total source files** | 214 |
| **Total tested files** | 65 |
| **Overall file coverage** | 30.4% |
| **Total source lines** | ~39,540 |
| **Total untested lines (runtime code)** | ~33,942 |
| **Pure type files (not testable)** | ~11 |
| **Effective testable files** | ~203 |
| **Effective coverage (testable only)** | 32.0% |

### Testing Strength Areas ✅
- **Server services**: 100% (22/22 files) — excellent
- **Server utils**: 100% (2/2 files)
- **Server middleware**: 100% (1/1)
- **Client lib**: 87.5% (14/16 files) — strong
- **Client context**: 75% (3/4 files)
- **Shared (testable code)**: ~100% of runtime exports tested

### Critical Gaps ❌

| Gap Area | Untested Files | Untested Lines | Impact |
|---|---|---|---|
| Client Screens | 31 | 19,468 | Highest line count, but UI-heavy (harder to unit test) |
| Client Components | 47 | 8,474 | UI components, would benefit from snapshot/interaction tests |
| Client Hooks | 27 | 1,919 | Pure logic hooks are highly testable |
| Server Routes | 14 | 3,845 | API validation & response logic, very testable |
| Server Storage | 12 | 2,339 | DB queries — covered by general storage.test.ts |

### Prioritized Testing Recommendations

**Tier 1 — High value, highly testable (pure logic):**
1. Untested server routes (14 files, 3,845 lines) — API endpoint validation
2. Untested client hooks (27 files, 1,919 lines) — state logic
3. `client/lib/healthkit.ts` (50 lines) and `client/lib/image-compression.ts` (86 lines)
4. `client/context/ThemeContext.tsx` (100 lines)

**Tier 2 — Medium value:**
5. Client components with significant logic: `upgrade-modal-utils.ts`, `SuggestionCard`, `AdaptiveGoalCard`
6. Camera `CameraView.tsx` (204 lines)

**Tier 3 — Lower priority (UI-heavy, harder to unit test):**
7. Client screens (31 files, 19,468 lines) — better served by integration/E2E tests
8. Remaining UI components — snapshot tests would add coverage quickly

### Additional Test Files (not in module `__tests__/`)

These server-level tests provide cross-cutting coverage:
- `server/__tests__/auth.test.ts` — tests auth middleware
- `server/__tests__/routes.test.ts` — route registration tests
- `server/__tests__/storage.test.ts` — storage interface tests (19K lines!)
- `server/__tests__/subscription.test.ts` — subscription flow tests
