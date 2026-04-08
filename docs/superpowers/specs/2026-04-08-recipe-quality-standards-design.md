# Recipe Quality Standards & Formatting

**Date:** 2026-04-08
**Status:** Draft
**Scope:** Cleanup junk recipes, enforce quality gates on all creation paths, normalize data formatting, ensure visual consistency with ingredient icons

## Problem

The community recipe list contains junk entries (e.g., multiple "Test Recipe" rows with no images, no real content). These slip through existing quality gates because the gates only check for empty instruction arrays, not for placeholder/minimal content. Additionally, recipe data formatting is inconsistent across creation paths, and ingredient icons from `assets/images/ingredients/` are not used in all screens where ingredients appear.

## Goals

1. Delete existing junk recipes from the database
2. Prevent future junk by adding quality validation to all recipe creation paths
3. Normalize recipe data (titles, ingredients, instructions) on save for consistent formatting
4. Use `IngredientIcon` component (backed by 180+ clay-style 3D icons) in all screens that render ingredients

## Non-Goals

- Admin moderation UI (not needed now)
- Retroactive normalization of all existing recipes (only new/updated recipes get normalized)
- Changes to the `IngredientIcon` component itself or the icon asset library

---

## Layer 1: Cleanup & Quality Gates

### 1a. One-Time Junk Deletion

A database cleanup script that deletes community recipes matching junk criteria:

- Title is exactly "Test Recipe" (case-insensitive)
- Title is under 3 characters
- Empty instructions array AND empty ingredients array

The script uses a direct SQL query (not the `deleteCommunityRecipe` storage function, which requires an `authorId` for IDOR protection). It deletes matching `communityRecipes` rows and their associated `cookbookRecipes` junction rows in a transaction. Run as a one-time operation via a standalone script (e.g., `scripts/cleanup-junk-recipes.ts`).

### 1b. Server-Side Quality Validation

A shared quality gate function applied to all recipe creation paths:

| Path          | File                                                | Current Validation                                  | New Validation                                                   |
| ------------- | --------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------- |
| AI-generated  | `server/routes/recipes.ts` POST `/generate`         | Title min 1 char                                    | Title min 3 chars, at least 1 instruction, at least 1 ingredient |
| Manual create | `server/routes/meal-plan.ts` POST `/recipes`        | Title min 1 char, instructions/ingredients optional | Title min 3 chars, at least 1 instruction OR 1 ingredient        |
| URL import    | `server/routes/recipes.ts` POST `/import-url`       | Rejects no instructions AND no ingredients          | Add title min 3 chars                                            |
| Catalog save  | `server/routes/recipes.ts` POST `/catalog/:id/save` | Rejects no instructions AND no ingredients          | Add title min 3 chars                                            |

The existing query-level filters in `getFeaturedRecipes` and `getUnifiedRecipes` remain as a safety net.

**Shared validation function** (new file `server/lib/recipe-validation.ts`):

```typescript
interface RecipeQualityInput {
  title: string;
  instructions?: string[] | null;
  ingredients?: { name: string }[] | null;
}

interface RecipeQualityResult {
  valid: boolean;
  reason?: string;
}

function validateRecipeQuality(input: RecipeQualityInput): RecipeQualityResult;
```

### 1c. Client-Side Validation

In `RecipeCreateScreen.handleSave`:

- Title must be at least 3 characters (currently only checks non-empty)
- At least 1 ingredient or 1 instruction step must be filled in
- Show specific validation messages via `setValidationError()`

---

## Layer 2: Data Normalization

### 2a. Ingredient Name Normalization

A shared server-side utility (`server/lib/recipe-normalization.ts`) applied at the route level on all creation paths:

- **Title Case names**: `"fresh spinach"` → `"Fresh Spinach"`
- **Split misplaced measurements**: If the `name` field contains a leading quantity+unit pattern (e.g., `"2 cups diced tomatoes"`), extract into `quantity` and `unit` fields, leaving `name` as `"Diced Tomatoes"`
- **Unit standardization**: Normalize common variations to canonical short forms:
  - `"tablespoon"` / `"Tbsp"` / `"tablespoons"` → `"tbsp"`
  - `"teaspoon"` / `"Tsp"` / `"teaspoons"` → `"tsp"`
  - `"ounce"` / `"ounces"` → `"oz"`
  - `"pound"` / `"pounds"` → `"lb"`
  - `"cup"` / `"cups"` → `"cup"` (already canonical)

### 2b. Instruction Formatting

Normalize instruction steps on save:

- Strip leading numbering (`"1. Preheat oven"` → `"Preheat oven"`) — the UI re-numbers them
- Trim whitespace
- Filter out empty steps
- Capitalize first letter of each step

### 2c. Title & Description Formatting

- **Title**: Title Case on save (`"chicken parmesan"` → `"Chicken Parmesan"`)
- **Description**: Capitalize first letter, ensure trailing period if it reads as a sentence
- **Difficulty**: Normalize to one of `"Easy"` / `"Medium"` / `"Hard"` — map common variations (e.g., `"easy"` → `"Easy"`, `"beginner"` → `"Easy"`, `"advanced"` → `"Hard"`), default to `null` if unrecognizable

---

## Layer 3: Visual Consistency

### 3a. IngredientIcon in All Ingredient Screens

Add `IngredientIcon` to 4 screens that currently render ingredients without it:

| Screen               | File                                                   | Change                                                          |
| -------------------- | ------------------------------------------------------ | --------------------------------------------------------------- |
| Recipe create form   | `client/screens/meal-plan/RecipeCreateScreen.tsx`      | Add `IngredientIcon` next to each ingredient row in the builder |
| URL import preview   | `client/screens/meal-plan/RecipeImportScreen.tsx`      | Add `IngredientIcon` next to each parsed ingredient             |
| Photo import preview | `client/screens/meal-plan/RecipePhotoImportScreen.tsx` | Add `IngredientIcon` next to each detected ingredient           |
| Receipt meal plan    | `client/screens/meal-plan/ReceiptMealPlanScreen.tsx`   | Add `IngredientIcon` next to each ingredient                    |

The existing `IngredientIcon` component handles missing matches gracefully (falls back to generic circle icon via Feather), so no new edge cases.

### 3b. Auto-Generate Images for Imageless Recipes

The existing `generateRecipeImage()` function in `server/services/recipe-generation.ts` uses Runware (primary, $0.0006/image) with DALL-E fallback. It generates food photography-style images and saves them to `uploads/recipe-images/`. Currently only used by:

- AI-generated recipes (POST `/api/recipes/generate`)
- Chat-created recipes (`recipe-chat.ts`)

**New behavior — generate images on all creation paths when none is provided:**

| Path          | Current Image Behavior                   | New Behavior                                                                         |
| ------------- | ---------------------------------------- | ------------------------------------------------------------------------------------ |
| AI-generated  | Always generates image                   | No change                                                                            |
| Manual create | User optionally provides URL             | If no `imageUrl` provided, auto-generate from title after save (async, non-blocking) |
| URL import    | Uses image from source page if available | If source has no image, auto-generate from title after save (async, non-blocking)    |
| Catalog save  | Uses Spoonacular image URL               | No change (Spoonacular always provides images)                                       |
| Photo import  | Uses the uploaded photo                  | No change                                                                            |

Image generation is **async and non-blocking** — the recipe is saved immediately and returned to the client. The image is generated in the background and the recipe's `imageUrl` is updated when ready. The client will see the image on next fetch/refresh.

**One-time backfill for existing imageless recipes:**

A standalone script (`scripts/backfill-recipe-images.ts`) that:

1. Queries all `communityRecipes` and `mealPlanRecipes` where `imageUrl IS NULL`
2. Generates images sequentially (to avoid rate limits) with a configurable delay between calls
3. Updates each recipe's `imageUrl` after successful generation
4. Logs progress and skips failures gracefully

### 3c. Recipe Card Consistency in Browse List

In `RecipeBrowserScreen`:

- **Missing image fallback**: Use `FallbackImage` consistently — no broken grey placeholders
- **Consistent card layout**: Same height, title/subtitle placement, and chevron for all recipe types (community, personal, catalog)
- **Source badge**: Keep existing "Community" label, ensure visual alignment matches across types

### 3d. Recipe Detail (No Changes)

`RecipeIngredientsList` already uses `IngredientIcon` with the full fuzzy matching pipeline. This is the reference implementation the other screens should match.

---

## Files Changed (Expected)

### New Files

- `server/lib/recipe-validation.ts` — shared quality gate function
- `server/lib/recipe-normalization.ts` — shared normalization utilities
- `server/lib/__tests__/recipe-validation.test.ts` — validation tests
- `server/lib/__tests__/recipe-normalization.test.ts` — normalization tests
- `scripts/cleanup-junk-recipes.ts` — one-time junk deletion script
- `scripts/backfill-recipe-images.ts` — one-time image generation for imageless recipes

### Modified Files

- `server/routes/recipes.ts` — apply validation + normalization to generate, import, catalog save
- `server/routes/meal-plan.ts` — apply validation + normalization to manual create
- `client/screens/meal-plan/RecipeCreateScreen.tsx` — client validation + IngredientIcon
- `client/screens/meal-plan/RecipeImportScreen.tsx` — add IngredientIcon
- `client/screens/meal-plan/RecipePhotoImportScreen.tsx` — add IngredientIcon
- `client/screens/meal-plan/ReceiptMealPlanScreen.tsx` — add IngredientIcon
- `client/screens/meal-plan/RecipeBrowserScreen.tsx` — card consistency fixes

---

## Testing Strategy

- Unit tests for `recipe-validation.ts` (valid/invalid inputs, edge cases)
- Unit tests for `recipe-normalization.ts` (title case, unit standardization, measurement splitting, instruction formatting)
- Existing route tests updated to verify 400 responses for junk input
- Existing `ingredient-icon.test.ts` remains unchanged (icon matching logic is not modified)
- Manual verification: run cleanup script, confirm "Test Recipe" entries are gone, create a new recipe and verify normalization + icons
