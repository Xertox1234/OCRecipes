import { z } from "zod";
import {
  allergenIdSchema,
  type DerivedRecipeAllergen,
} from "@shared/constants/allergens";

export interface SearchableRecipe {
  id: string; // "personal:42", "community:17", "spoonacular:654321"
  source: "personal" | "community" | "spoonacular";
  userId: string | null; // owner ID for personal recipes (IDOR protection)
  title: string;
  description: string | null;
  ingredients: string[]; // flattened ingredient names for search
  cuisine: string | null;
  dietTags: string[];
  mealTypes: string[];
  difficulty: string | null;
  prepTimeMinutes: number | null;
  cookTimeMinutes: number | null;
  totalTimeMinutes: number | null;
  caloriesPerServing: number | null;
  proteinPerServing: number | null;
  carbsPerServing: number | null;
  fatPerServing: number | null;
  servings: number | null;
  imageUrl: string | null;
  sourceUrl: string | null;
  createdAt: string | null;
  isCanonical: boolean;
  /**
   * Denormalized allergen cache derived from ingredient names. `null` means the
   * recipe has not been analyzed yet — `isRecipeSafeForAllergies` treats `null`
   * as unsafe (fail-closed). `[]` means "derived, genuinely no allergens" = safe.
   */
  allergens: DerivedRecipeAllergen[] | null;
}

export interface RecipeSearchParams {
  q?: string;
  ingredients?: string;
  pantry?: boolean;
  cuisine?: string;
  diet?: string;
  mealType?: string;
  difficulty?: string;
  maxPrepTime?: number;
  maxCalories?: number;
  minProtein?: number;
  curatedOnly?: boolean;
  /** Exclude recipes unsafe for the user's declared allergies. */
  safeForMe?: boolean;
  sort?: "relevance" | "newest" | "quickest" | "calories_asc" | "popular";
  source?: "all" | "personal" | "community" | "spoonacular";
  limit?: number;
  offset?: number;
}

export interface RecipeSearchResponse {
  results: SearchableRecipe[];
  total: number;
  offset: number;
  limit: number;
  query: {
    q: string | null;
    filters: Record<string, string | number | boolean>;
    sort: string;
  };
}

/**
 * Runtime schema for the GET /api/recipes/search response. Validated at the
 * network boundary in `useRecipeSearch` so server contract drift surfaces as a
 * structured error instead of a silent `undefined` downstream.
 */
const derivedRecipeAllergenSchema = z.object({
  id: allergenIdSchema,
  viaDerived: z.boolean(),
});

const searchableRecipeSchema = z.object({
  id: z.string(),
  source: z.enum(["personal", "community", "spoonacular"]),
  userId: z.string().nullable(),
  title: z.string(),
  description: z.string().nullable(),
  ingredients: z.array(z.string()),
  cuisine: z.string().nullable(),
  dietTags: z.array(z.string()),
  mealTypes: z.array(z.string()),
  difficulty: z.string().nullable(),
  prepTimeMinutes: z.number().nullable(),
  cookTimeMinutes: z.number().nullable(),
  totalTimeMinutes: z.number().nullable(),
  caloriesPerServing: z.number().nullable(),
  proteinPerServing: z.number().nullable(),
  carbsPerServing: z.number().nullable(),
  fatPerServing: z.number().nullable(),
  servings: z.number().nullable(),
  imageUrl: z.string().nullable(),
  sourceUrl: z.string().nullable(),
  createdAt: z.string().nullable(),
  isCanonical: z.boolean(),
  allergens: z.array(derivedRecipeAllergenSchema).nullable(),
});

export const recipeSearchResponseSchema = z.object({
  results: z.array(searchableRecipeSchema),
  total: z.number(),
  offset: z.number(),
  limit: z.number(),
  query: z.object({
    q: z.string().nullable(),
    filters: z.record(
      z.string(),
      z.union([z.string(), z.number(), z.boolean()]),
    ),
    sort: z.string(),
  }),
});
