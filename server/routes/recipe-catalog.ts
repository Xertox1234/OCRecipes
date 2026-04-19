import type { Express, Response } from "express";
import { storage } from "../storage";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth";
import { sendError } from "../lib/api-errors";
import { ErrorCode } from "@shared/constants/error-codes";
import {
  parseUserAllergies,
  type AllergenId,
} from "@shared/constants/allergens";
import { inferMealTypes } from "../services/meal-type-inference";
import {
  searchCatalogRecipes,
  getCatalogRecipeDetail,
  CatalogQuotaError,
} from "../services/recipe-catalog";
import { mealPlanRateLimit } from "./_rate-limiters";
import {
  checkPremiumFeature,
  formatZodError,
  handleRouteError,
  parsePositiveIntParam,
} from "./_helpers";
import { catalogSearchSchema } from "@shared/schemas/recipe";

/**
 * Maps OCRecipes allergen IDs to Spoonacular intolerance parameter values.
 * See: https://spoonacular.com/food-api/docs#Intolerances
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

function buildIntolerancesParam(allergies: unknown): string | undefined {
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

export function register(app: Express): void {
  // GET /api/meal-plan/catalog/search — Spoonacular search (premium)
  // Every call burns a Spoonacular quota unit, so this must be gated
  // alongside the sibling /save + /import-url endpoints. See H7 — 2026-04-18.
  app.get(
    "/api/meal-plan/catalog/search",
    requireAuth,
    mealPlanRateLimit,
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      try {
        const features = await checkPremiumFeature(
          req,
          res,
          "catalogSave",
          "Recipe catalog",
        );
        if (!features) return;

        const parsed = catalogSearchSchema.safeParse(req.query);
        if (!parsed.success) {
          sendError(
            res,
            400,
            formatZodError(parsed.error),
            ErrorCode.VALIDATION_ERROR,
          );
          return;
        }

        // Inject user's allergens as Spoonacular intolerances
        const profile = await storage.getUserProfile(req.userId);
        const intolerances = buildIntolerancesParam(profile?.allergies);

        const results = await searchCatalogRecipes({
          ...parsed.data,
          ...(intolerances && { intolerances }),
        });
        res.json(results);
      } catch (error) {
        if (error instanceof CatalogQuotaError) {
          sendError(res, 402, error.message, ErrorCode.CATALOG_QUOTA_EXCEEDED);
          return;
        }
        handleRouteError(res, error, "search recipes");
      }
    },
  );

  // GET /api/meal-plan/catalog/:id — Spoonacular recipe detail (premium)
  // Fetching detail also costs a Spoonacular quota unit (cache TTL is 60 min
  // with a 200-entry cap, so free users could still drain quota via fresh
  // IDs). Gated together with /search + /save. See H7 — 2026-04-18.
  app.get(
    "/api/meal-plan/catalog/:id",
    requireAuth,
    mealPlanRateLimit,
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      try {
        const features = await checkPremiumFeature(
          req,
          res,
          "catalogSave",
          "Recipe catalog",
        );
        if (!features) return;

        const id = parsePositiveIntParam(req.params.id);
        if (!id) {
          sendError(res, 400, "Invalid catalog ID", ErrorCode.VALIDATION_ERROR);
          return;
        }

        const detail = await getCatalogRecipeDetail(id);
        if (!detail) {
          sendError(
            res,
            404,
            "Recipe not found in catalog",
            ErrorCode.NOT_FOUND,
          );
          return;
        }

        res.json(detail);
      } catch (error) {
        if (error instanceof CatalogQuotaError) {
          sendError(res, 402, error.message, ErrorCode.CATALOG_QUOTA_EXCEEDED);
          return;
        }
        handleRouteError(res, error, "fetch recipe detail");
      }
    },
  );

  // POST /api/meal-plan/catalog/:id/save — Save catalog recipe to DB
  app.post(
    "/api/meal-plan/catalog/:id/save",
    requireAuth,
    mealPlanRateLimit,
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      try {
        // Gate before hitting Spoonacular (1 quota unit per detail fetch)
        const features = await checkPremiumFeature(
          req,
          res,
          "catalogSave",
          "Catalog save",
        );
        if (!features) return;

        const id = parsePositiveIntParam(req.params.id);
        if (!id) {
          sendError(res, 400, "Invalid catalog ID", ErrorCode.VALIDATION_ERROR);
          return;
        }

        // Dedup: check if already saved
        const existing = await storage.findMealPlanRecipeByExternalId(
          req.userId,
          String(id),
        );
        if (existing) {
          res.json(existing);
          return;
        }

        // Fetch from Spoonacular
        const detail = await getCatalogRecipeDetail(id);
        if (!detail) {
          sendError(
            res,
            404,
            "Recipe not found in catalog",
            ErrorCode.NOT_FOUND,
          );
          return;
        }

        // Quality gate: reject recipes with no usable content
        const hasInstructions =
          detail.recipe.instructions &&
          Array.isArray(detail.recipe.instructions) &&
          detail.recipe.instructions.length > 0;
        const hasIngredients =
          detail.ingredients && detail.ingredients.length > 0;
        if (!hasInstructions && !hasIngredients) {
          sendError(
            res,
            422,
            "This recipe has no instructions or ingredients and cannot be saved",
            ErrorCode.VALIDATION_ERROR,
          );
          return;
        }

        // Set the userId and infer meal types if not provided
        detail.recipe.userId = req.userId;
        if (!detail.recipe.mealTypes || detail.recipe.mealTypes.length === 0) {
          detail.recipe.mealTypes = inferMealTypes(
            detail.recipe.title,
            detail.ingredients?.map((i) => i.name),
          );
        }
        const saved = await storage.createMealPlanRecipe(
          detail.recipe,
          detail.ingredients,
        );

        res.status(201).json(saved);
      } catch (error) {
        if (error instanceof CatalogQuotaError) {
          sendError(res, 402, error.message, ErrorCode.CATALOG_QUOTA_EXCEEDED);
          return;
        }
        // Handle TOCTOU race: concurrent save creates duplicate — return existing
        if (
          error instanceof Error &&
          "code" in error &&
          (error as { code: string }).code === "23505"
        ) {
          const existing = await storage.findMealPlanRecipeByExternalId(
            req.userId,
            String(parsePositiveIntParam(req.params.id)),
          );
          if (existing) {
            res.json(existing);
            return;
          }
        }
        handleRouteError(res, error, "catalog save");
      }
    },
  );
}
