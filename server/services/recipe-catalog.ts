import {
  catalogSearchResponseSchema,
  type CatalogSearchResult,
  type CatalogSearchResponse,
} from "@shared/types/recipe-catalog";
import { createServiceLogger, toError } from "../lib/logger";
import { cachedFetch } from "./dev-api-cache";
import {
  parseUserAllergies,
  type AllergenId,
} from "@shared/constants/allergens";

const log = createServiceLogger("recipe-catalog");

const SPOONACULAR_BASE = "https://api.spoonacular.com";

// Timeout for outbound API requests (10 seconds)
const FETCH_TIMEOUT_MS = 10_000;

const SPOONACULAR_API_KEY = process.env.SPOONACULAR_API_KEY;
if (!SPOONACULAR_API_KEY && process.env.NODE_ENV !== "test") {
  log.warn("SPOONACULAR_API_KEY is not set — catalog search will be disabled");
}

// ── Types ────────────────────────────────────────────────────────────

export type { CatalogSearchResult, CatalogSearchResponse };

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

// ── Exported API Functions ───────────────────────────────────────────

/**
 * `strict` (recipe finder only) throws where the default returns an empty
 * list — a missing key or a reply that is not a search result — so a caller
 * can tell "unavailable" from "no results".
 */
export async function searchCatalogRecipes(
  params: CatalogSearchParams,
  opts: { strict?: boolean } = {},
): Promise<CatalogSearchResponse> {
  if (!SPOONACULAR_API_KEY) {
    if (opts.strict) throw new Error("Spoonacular API key not configured");
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

  const res = await cachedFetch("spoonacular", url.toString(), {
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
    if (opts.strict) throw new Error("Spoonacular search parse error");
    return { results: [], offset: 0, number: 0, totalResults: 0 };
  }

  return parsed.data;
}

export class CatalogQuotaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CatalogQuotaError";
  }
}

/**
 * Maps OCRecipes allergen IDs to Spoonacular intolerance parameter values.
 * See: https://spoonacular.com/food-api/docs#Intolerances
 * (Moved from server/routes/recipe-catalog.ts so the recipe finder shares it.)
 */
const SPOONACULAR_INTOLERANCE_MAP: Partial<Record<AllergenId, string>> = {
  peanuts: "peanut",
  tree_nuts: "tree nut",
  milk: "dairy",
  eggs: "egg",
  wheat: "wheat",
  soy: "soy",
  fish: "seafood",
  shellfish: "shellfish",
  sesame: "sesame",
};

export function buildIntolerancesParam(allergies: unknown): string | undefined {
  const parsed = parseUserAllergies(allergies);
  if (parsed.length === 0) return undefined;
  const values: string[] = [];
  for (const allergy of parsed) {
    const spoonacularValue =
      SPOONACULAR_INTOLERANCE_MAP[allergy.name as AllergenId];
    if (spoonacularValue) values.push(spoonacularValue);
  }
  return values.length > 0 ? values.join(",") : undefined;
}
