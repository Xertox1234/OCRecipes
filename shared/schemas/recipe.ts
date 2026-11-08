// shared/schemas/recipe.ts
//
// Canonical Zod schemas for recipe-related API endpoints. Shared between
// server route files so clients can also import for validation and type
// inference without duplicating schema definitions in each route file.
import { z } from "zod";

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

/** UTF-8 byte length without Buffer/TextEncoder (shared/ also runs on Hermes). */
export function utf8ByteLength(str: string): number {
  let bytes = 0;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      bytes += 4; // surrogate pair
      i++;
    } else bytes += 3;
  }
  return bytes;
}

/** Max JSON-LD blocks posted to parse-page. */
export const PARSE_PAGE_MAX_BLOCKS = 20;

/** Max total UTF-8 bytes across all JSON-LD blocks posted to parse-page. */
export const PARSE_PAGE_MAX_BYTES = 1_000_000;

/**
 * Schema for the parse-page endpoint: raw JSON-LD script texts extracted on
 * the device. Untrusted input — block count and total byte size are capped
 * (bytes, not chars: multibyte text must not slip past the limit).
 */
export const parsePageSchema = z
  .object({
    url: importUrlSchema.shape.url,
    ldJson: z.array(z.string()).min(1).max(PARSE_PAGE_MAX_BLOCKS),
  })
  .refine(
    (v) =>
      v.ldJson.reduce((n, b) => n + utf8ByteLength(b), 0) <=
      PARSE_PAGE_MAX_BYTES,
    { message: "ldJson is too large", path: ["ldJson"] },
  );

export type ParsePageParams = z.infer<typeof parsePageSchema>;

/**
 * Canonical allowlist of diet preference options. Kept in shared/ so both the
 * client UI (RecipeGenerationModal) and the server Zod schema reference the
 * same set — prevents arbitrary strings from flowing into AI prompts (M2).
 */
export const DIET_OPTIONS = [
  "Vegetarian",
  "Vegan",
  "Gluten-Free",
  "Low-Carb",
  "Keto",
  "Dairy-Free",
  "Kid-Friendly",
  "Quick & Easy",
] as const;

export type DietOption = (typeof DIET_OPTIONS)[number];

/** Schema for community recipe generation (POST /api/recipes/generate). */
export const recipeGenerationSchema = z.object({
  productName: z.string().min(3).max(200),
  /** Barcode must match the project-wide digit-only format (8–14 digits). */
  barcode: z
    .string()
    .regex(/^\d{8,14}$/, "Barcode must be 8–14 digits")
    .optional()
    .nullable(),
  servings: z.number().int().min(1).max(20).optional(),
  /** Only known diet options are accepted — prevents prompt injection via free-text. */
  dietPreferences: z.array(z.enum(DIET_OPTIONS)).max(10).optional(),
  timeConstraint: z.string().max(50).optional(),
  shareToPublic: z.boolean().optional(),
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
  safeForMe: z
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
