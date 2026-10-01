import {
  formatTimeDisplay,
  parseNutritionData,
} from "@/components/recipe-detail/recipe-detail-utils";
import type { IngredientItem } from "@/components/recipe-detail";
import { ApiError } from "@/lib/api-error";
import { ErrorCode } from "@shared/constants/error-codes";

export type FeaturedRecipeType = "community" | "mealPlan" | "catalog";

/**
 * Route params are typed, but a link's repeated query key arrives as an
 * array (linking.ts's `parse` skips non-strings) — only an exact string may
 * select a branch. `type` (the link alias) can never select "catalog".
 */
export function resolveFeaturedRecipeType(
  recipeType: unknown,
  type: unknown,
): FeaturedRecipeType {
  if (
    recipeType === "catalog" ||
    recipeType === "mealPlan" ||
    recipeType === "community"
  ) {
    return recipeType;
  }
  if (type === "mealPlan") return "mealPlan";
  return "community";
}

/** GET /api/meal-plan/catalog/:id (server/routes/recipe-catalog.ts). */
export interface CatalogDetailResponse {
  recipe: {
    title: string;
    description?: string | null;
    difficulty?: string | null;
    servings?: number | null;
    prepTimeMinutes?: number | null;
    cookTimeMinutes?: number | null;
    imageUrl?: string | null;
    instructions?: string[] | null;
    dietTags?: string[] | null;
    caloriesPerServing?: string | null;
    proteinPerServing?: string | null;
    carbsPerServing?: string | null;
    fatPerServing?: string | null;
  };
  ingredients: {
    name: string;
    quantity?: string | null;
    unit?: string | null;
  }[];
}

export function normalizeCatalogDetail(detail: CatalogDetailResponse) {
  const r = detail.recipe;
  const ingredients: IngredientItem[] = detail.ingredients.map((i) => ({
    name: i.name,
    quantity: i.quantity ?? null,
    unit: i.unit ?? null,
  }));
  return {
    title: r.title,
    description: r.description ?? null,
    difficulty: r.difficulty ?? null,
    timeDisplay: formatTimeDisplay(r.prepTimeMinutes, r.cookTimeMinutes),
    servings: r.servings ?? null,
    dietTags: r.dietTags ?? [],
    instructions: r.instructions ?? [],
    ingredients,
    imageUrl: r.imageUrl ?? null,
    nutrition: parseNutritionData(r),
  };
}

/**
 * Copy for a failed catalog Save (POST /api/meal-plan/catalog/:id/save). Only
 * a transient failure asks the user to try again: a 404 (gone from the
 * catalog) and a 422 (the server's no-ingredients-no-steps quality gate) fail
 * the same way every time. PREMIUM_REQUIRED is handled by the caller (it opens
 * the upgrade modal instead of showing copy).
 */
export function catalogSaveErrorMessage(err: unknown): {
  message: string;
  retryable: boolean;
} {
  if (err instanceof ApiError) {
    if (err.code === ErrorCode.CATALOG_QUOTA_EXCEEDED) {
      return {
        message: "Spoonacular isn't available right now. Try again later.",
        retryable: false,
      };
    }
    if (err.code === ErrorCode.NOT_FOUND) {
      return {
        message: "This recipe is no longer available.",
        retryable: false,
      };
    }
    if (err.code === ErrorCode.VALIDATION_ERROR) {
      return {
        message:
          "This recipe has no ingredients or steps, so it can't be saved.",
        retryable: false,
      };
    }
  }
  return { message: "Couldn't save this recipe. Try again.", retryable: true };
}
