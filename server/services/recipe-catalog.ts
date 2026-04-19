import { z } from "zod";
import type {
  InsertMealPlanRecipe,
  InsertRecipeIngredient,
} from "@shared/schema";
import { createServiceLogger } from "../lib/logger";

const log = createServiceLogger("recipe-catalog");

const SPOONACULAR_BASE = "https://api.spoonacular.com";

// Timeout for outbound API requests (10 seconds)
const FETCH_TIMEOUT_MS = 10_000;

const SPOONACULAR_API_KEY = process.env.SPOONACULAR_API_KEY;
if (!SPOONACULAR_API_KEY && process.env.NODE_ENV !== "test") {
  log.warn("SPOONACULAR_API_KEY is not set — catalog search will be disabled");
}

// ── Zod Schemas for Spoonacular responses ────────────────────────────

const catalogSearchResultSchema = z.object({
  id: z.number(),
  title: z.string(),
  image: z.string().optional(),
  imageType: z.string().optional(),
  readyInMinutes: z.number().optional(),
});

const catalogSearchResponseSchema = z.object({
  results: z.array(catalogSearchResultSchema),
  offset: z.number(),
  number: z.number(),
  totalResults: z.number(),
});

const nutrientSchema = z.object({
  name: z.string(),
  amount: z.number(),
  unit: z.string(),
});

const extendedIngredientSchema = z.object({
  id: z.number().optional(),
  name: z.string(),
  amount: z.number().optional(),
  unit: z.string().optional(),
  original: z.string().optional(),
});

const recipeDetailSchema = z.object({
  id: z.number(),
  title: z.string(),
  image: z.string().optional(),
  readyInMinutes: z.number().optional(),
  preparationMinutes: z.number().nullable().optional(),
  cookingMinutes: z.number().nullable().optional(),
  servings: z.number().optional(),
  sourceUrl: z.string().optional(),
  summary: z.string().optional(),
  instructions: z.string().optional(),
  cuisines: z.array(z.string()).optional(),
  diets: z.array(z.string()).optional(),
  extendedIngredients: z.array(extendedIngredientSchema).optional(),
  nutrition: z
    .object({
      nutrients: z.array(nutrientSchema),
    })
    .optional(),
});

// ── Types ────────────────────────────────────────────────────────────

export type CatalogSearchResult = z.infer<typeof catalogSearchResultSchema>;

export type CatalogSearchResponse = {
  results: CatalogSearchResult[];
  offset: number;
  number: number;
  totalResults: number;
};

export interface CatalogSearchParams {
  query: string;
  cuisine?: string;
  diet?: string;
  type?: string;
  maxReadyTime?: number;
  offset?: number;
  number?: number;
  /** Comma-separated Spoonacular intolerance values (e.g. "dairy,peanut"). */
  intolerances?: string;
}

// ── Detail Cache (module-level singleton) ────────────────────────────

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const detailCache = new Map<
  number,
  CacheEntry<z.infer<typeof recipeDetailSchema>>
>();
const DETAIL_CACHE_TTL = 60 * 60 * 1000; // 1 hour
const MAX_CACHE_ENTRIES = 200;

function getCachedDetail(
  id: number,
): z.infer<typeof recipeDetailSchema> | null {
  const entry = detailCache.get(id);
  if (entry && Date.now() - entry.timestamp < DETAIL_CACHE_TTL) {
    return entry.data;
  }
  if (entry) {
    detailCache.delete(id);
  }
  return null;
}

function setCachedDetail(
  id: number,
  data: z.infer<typeof recipeDetailSchema>,
): void {
  // Evict oldest entry if cache is full
  if (detailCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = detailCache.keys().next().value;
    if (oldestKey !== undefined) detailCache.delete(oldestKey);
  }
  detailCache.set(id, { data, timestamp: Date.now() });
}

/** Clear the detail cache. Exported for testing. */
export function clearDetailCache(): void {
  detailCache.clear();
}

// ── Helpers ──────────────────────────────────────────────────────────

function findNutrient(
  nutrients: z.infer<typeof nutrientSchema>[],
  name: string,
): number | null {
  const n = nutrients.find(
    (nut) => nut.name.toLowerCase() === name.toLowerCase(),
  );
  if (!n) return null;
  // Defense-in-depth: Spoonacular normally returns kcal for Calories, but if
  // the contract shifts to kJ we'd silently store 4.18× the real value.
  if (name.toLowerCase() === "calories" && n.unit !== "kcal") {
    log.warn(
      { unit: n.unit, amount: n.amount },
      "Spoonacular Calories nutrient has unexpected unit — expected kcal",
    );
    // Best-effort conversion if kJ
    if (n.unit === "kJ") {
      return Math.round(n.amount / 4.184);
    }
  }
  return n.amount;
}

function mapToMealPlanRecipe(
  detail: z.infer<typeof recipeDetailSchema>,
  userId: string,
): {
  recipe: InsertMealPlanRecipe;
  ingredients: InsertRecipeIngredient[];
} {
  const nutrients = detail.nutrition?.nutrients || [];

  const recipe: InsertMealPlanRecipe = {
    userId,
    title: detail.title,
    description: detail.summary
      ? detail.summary.replace(/<[^>]*>/g, "").slice(0, 2000)
      : null,
    sourceType: "catalog",
    sourceUrl: detail.sourceUrl || null,
    externalId: String(detail.id),
    cuisine: detail.cuisines?.[0] || null,
    difficulty: null,
    servings: detail.servings || 2,
    prepTimeMinutes: detail.preparationMinutes ?? null,
    cookTimeMinutes: detail.cookingMinutes ?? null,
    imageUrl: detail.image || null,
    instructions: detail.instructions
      ? detail.instructions
          .replace(/<[^>]*>/g, "")
          .split(/\n/)
          .map((s: string) => s.replace(/^\d+[\.\)\:\-]\s*/, "").trim())
          .filter((s: string) => s.length > 0)
      : undefined,
    dietTags: detail.diets || [],
    caloriesPerServing: findNutrient(nutrients, "Calories")?.toString() ?? null,
    proteinPerServing: findNutrient(nutrients, "Protein")?.toString() ?? null,
    carbsPerServing:
      findNutrient(nutrients, "Carbohydrates")?.toString() ?? null,
    fatPerServing: findNutrient(nutrients, "Fat")?.toString() ?? null,
    fiberPerServing: findNutrient(nutrients, "Fiber")?.toString() ?? null,
    sugarPerServing: findNutrient(nutrients, "Sugar")?.toString() ?? null,
    sodiumPerServing: findNutrient(nutrients, "Sodium")?.toString() ?? null,
  };

  const ingredients: InsertRecipeIngredient[] = (
    detail.extendedIngredients || []
  ).map((ing, idx) => ({
    recipeId: 0, // set by storage
    name: ing.name,
    quantity: ing.amount?.toString() ?? null,
    unit: ing.unit || null,
    category: "other",
    displayOrder: idx,
  }));

  return { recipe, ingredients };
}

// ── Exported API Functions ───────────────────────────────────────────

export async function searchCatalogRecipes(
  params: CatalogSearchParams,
): Promise<CatalogSearchResponse> {
  if (!SPOONACULAR_API_KEY) {
    return { results: [], offset: 0, number: 0, totalResults: 0 };
  }

  const url = new URL(`${SPOONACULAR_BASE}/recipes/complexSearch`);
  url.searchParams.set("apiKey", SPOONACULAR_API_KEY);
  url.searchParams.set("query", params.query);
  url.searchParams.set("number", String(params.number || 10));
  url.searchParams.set("offset", String(params.offset || 0));
  // Only return recipes that have instructions — prevents empty recipe cards
  url.searchParams.set("instructionsRequired", "true");
  if (params.cuisine) url.searchParams.set("cuisine", params.cuisine);
  if (params.diet) url.searchParams.set("diet", params.diet);
  if (params.type) url.searchParams.set("type", params.type);
  if (params.maxReadyTime)
    url.searchParams.set("maxReadyTime", String(params.maxReadyTime));
  if (params.intolerances)
    url.searchParams.set("intolerances", params.intolerances);

  const res = await fetch(url.toString(), {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (res.status === 402) {
    throw new CatalogQuotaError("Spoonacular API quota exceeded");
  }
  if (!res.ok) {
    throw new Error(`Spoonacular search failed: ${res.status}`);
  }

  const json = await res.json();
  const parsed = catalogSearchResponseSchema.safeParse(json);
  if (!parsed.success) {
    log.warn(
      { zodErrors: parsed.error.flatten() },
      "Spoonacular search parse error",
    );
    return { results: [], offset: 0, number: 0, totalResults: 0 };
  }

  return parsed.data;
}

export async function getCatalogRecipeDetail(spoonacularId: number): Promise<{
  recipe: InsertMealPlanRecipe;
  ingredients: InsertRecipeIngredient[];
} | null> {
  // Check cache first
  const cached = getCachedDetail(spoonacularId);
  if (cached) {
    return mapToMealPlanRecipe(cached, "");
  }

  if (!SPOONACULAR_API_KEY) return null;

  const url = `${SPOONACULAR_BASE}/recipes/${spoonacularId}/information?includeNutrition=true&apiKey=${SPOONACULAR_API_KEY}`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (res.status === 402) {
    throw new CatalogQuotaError("Spoonacular API quota exceeded");
  }
  if (!res.ok) {
    throw new Error(`Spoonacular detail failed: ${res.status}`);
  }

  const json = await res.json();
  const parsed = recipeDetailSchema.safeParse(json);
  if (!parsed.success) {
    log.warn(
      { zodErrors: parsed.error.flatten() },
      "Spoonacular detail parse error",
    );
    return null;
  }

  // Store in cache before returning
  setCachedDetail(spoonacularId, parsed.data);

  // userId will be set by the route handler; use empty string as placeholder
  return mapToMealPlanRecipe(parsed.data, "");
}

export class CatalogQuotaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CatalogQuotaError";
  }
}

// ── Ingredient Substitution Lookup ───────────────────────────────────

const substitutesResponseSchema = z.object({
  substitutes: z.array(z.string()),
  message: z.string().optional(),
});

/**
 * Fetch ingredient substitution suggestions from Spoonacular.
 * Returns plain-text substitute descriptions (e.g. "1 cup margarine").
 * Returns empty array if the API key is missing or the request fails.
 */
export async function getSpoonacularSubstitutes(
  ingredientName: string,
): Promise<string[]> {
  if (!SPOONACULAR_API_KEY) return [];

  const url = new URL(`${SPOONACULAR_BASE}/food/ingredients/substitutes`);
  url.searchParams.set("apiKey", SPOONACULAR_API_KEY);
  url.searchParams.set("ingredientName", ingredientName);

  try {
    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (res.status === 402) return []; // quota exceeded — degrade gracefully
    if (!res.ok) return [];

    const json = await res.json();
    const parsed = substitutesResponseSchema.safeParse(json);
    if (!parsed.success) return [];

    return parsed.data.substitutes;
  } catch {
    return []; // network error — degrade gracefully
  }
}

// Re-export for testing
export { findNutrient, mapToMealPlanRecipe, recipeDetailSchema };
