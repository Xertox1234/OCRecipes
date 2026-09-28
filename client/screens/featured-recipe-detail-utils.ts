import {
  formatTimeDisplay,
  parseNutritionData,
} from "@/components/recipe-detail/recipe-detail-utils";
import type { IngredientItem } from "@/components/recipe-detail";

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
