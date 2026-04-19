// shared/schemas/recipe.ts
//
// Canonical Zod schemas for recipe-related API endpoints. Shared between
// server route files so clients can also import for validation and type
// inference without duplicating schema definitions in each route file.
import { z } from "zod";

/** Schema for the recipe-catalog Spoonacular search endpoint. */
export const catalogSearchSchema = z.object({
  query: z.string().min(1).max(200),
  cuisine: z.string().max(100).optional(),
  diet: z.string().max(100).optional(),
  type: z.string().max(100).optional(),
  maxReadyTime: z.coerce.number().int().min(1).max(1440).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  number: z.coerce.number().int().min(1).max(50).optional(),
});

export type CatalogSearchParams = z.infer<typeof catalogSearchSchema>;

/**
 * Schema for URL import / parse-url endpoints.
 * 1024 matches typical browser/proxy URL limits (Chrome/IE are ~2KB total,
 * but most origin servers reject anything over ~1KB). Longer URLs almost
 * always indicate tracking params or pasted junk, not real recipe pages.
 */
export const importUrlSchema = z.object({
  url: z
    .string()
    .url()
    .max(1024)
    .refine(
      (url) => /^https?:\/\//.test(url),
      "Only HTTP/HTTPS URLs are supported",
    ),
});

export type ImportUrlParams = z.infer<typeof importUrlSchema>;

/** Schema for community recipe generation (POST /api/recipes/generate). */
export const recipeGenerationSchema = z.object({
  productName: z.string().min(3).max(200),
  barcode: z.string().max(100).optional().nullable(),
  servings: z.number().int().min(1).max(20).optional(),
  dietPreferences: z.array(z.string().max(50)).max(10).optional(),
  timeConstraint: z.string().max(50).optional(),
});

export type RecipeGenerationParams = z.infer<typeof recipeGenerationSchema>;

/** Schema for the MiniSearch-backed recipe search endpoint. */
export const searchQuerySchema = z.object({
  q: z.string().max(200).optional(),
  ingredients: z.string().max(500).optional(),
  pantry: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  cuisine: z.string().max(50).optional(),
  diet: z.string().max(50).optional(),
  mealType: z.enum(["breakfast", "lunch", "dinner", "snack"]).optional(),
  difficulty: z.enum(["easy", "medium", "hard"]).optional(),
  maxPrepTime: z.coerce.number().int().min(1).max(480).optional(),
  maxCalories: z.coerce.number().int().min(1).max(5000).optional(),
  minProtein: z.coerce.number().int().min(0).max(500).optional(),
  sort: z
    .enum(["relevance", "newest", "quickest", "calories_asc", "popular"])
    .optional(),
  source: z.enum(["all", "personal", "community"]).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export type SearchQueryParams = z.infer<typeof searchQuerySchema>;

/** Schema for the unified recipe browse endpoint. */
export const browseQuerySchema = z.object({
  query: z.string().max(200).optional(),
  cuisine: z.string().max(50).optional(),
  diet: z.string().max(50).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  mealType: z.enum(["breakfast", "lunch", "dinner", "snack"]).optional(),
});

export type BrowseQueryParams = z.infer<typeof browseQuerySchema>;

/** Schema for the meal-plan recipe generation prompt endpoint. */
export const generatePromptSchema = z.object({
  prompt: z.string().min(3).max(500),
});

export type GeneratePromptParams = z.infer<typeof generatePromptSchema>;
