import type { Express, Response } from "express";
import { z } from "zod";
import type { MealPlanRecipe } from "@shared/schema";
import { storage } from "../storage";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth";
import { sendError } from "../lib/api-errors";
import { isUniqueViolation } from "../lib/db-errors";
import { ErrorCode } from "@shared/constants/error-codes";
import { inferMealTypes } from "../services/meal-type-inference";
import {
  searchCatalogRecipes,
  getCatalogRecipeDetail,
  CatalogQuotaError,
  buildIntolerancesParam,
} from "../services/recipe-catalog";
import { mealPlanRateLimit } from "./_rate-limiters";
import {
  checkPremiumFeature,
  formatZodError,
  handleRouteError,
  parsePositiveIntParam,
} from "./_helpers";
import { catalogSearchSchema } from "@shared/schemas/recipe";

const catalogSaveBodySchema = z.object({
  addToSavedItems: z.boolean().optional(),
});

function mealPlanSavedItemLink(recipe: MealPlanRecipe) {
  const minutes = (recipe.prepTimeMinutes ?? 0) + (recipe.cookTimeMinutes ?? 0);
  return {
    recipeId: recipe.id,
    recipeType: "mealPlan" as const,
    title: recipe.title,
    description: recipe.description,
    difficulty: recipe.difficulty,
    timeEstimate: minutes > 0 ? `${minutes} min` : null,
  };
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

  // GET /api/meal-plan/catalog/config — capability probe: is the online catalog
  // configured for this deployment? NOT premium-gated and NOT a quota cost — the
  // premium gate on /search, /:id, /save is unchanged. Rate-limited with
  // mealPlanRateLimit (like its siblings) so the auth'd handler isn't unbounded —
  // defense-in-depth for the requireAuth check (the client only probes once per
  // session). Read process.env at REQUEST time (not a module-load const) so tests
  // can toggle it. MUST be registered before /catalog/:id (else the param route
  // swallows "config" → 400 invalid id).
  app.get(
    "/api/meal-plan/catalog/config",
    requireAuth,
    mealPlanRateLimit,
    (_req: AuthenticatedRequest, res: Response): void => {
      res.json({ enabled: Boolean(process.env.SPOONACULAR_API_KEY) });
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

        const body = catalogSaveBodySchema.safeParse(req.body ?? {});
        if (!body.success) {
          sendError(
            res,
            400,
            formatZodError(body.error),
            ErrorCode.VALIDATION_ERROR,
          );
          return;
        }
        // The preview's Save asks for a Saved Items row (user ruling
        // 2026-09-29); Coach's meal-plan slot saves without asking.
        const respond = async (status: number, recipe: MealPlanRecipe) => {
          if (!body.data.addToSavedItems) {
            res.status(status).json(recipe);
            return;
          }
          const savedItemStatus = await storage.saveRecipeToSavedItems(
            req.userId,
            mealPlanSavedItemLink(recipe),
          );
          res.status(status).json({ ...recipe, savedItemStatus });
        };

        // Dedup: check if already saved. Still links, so a recipe saved
        // before Saved Items linking shipped gets its row on the next tap.
        const existing = await storage.findMealPlanRecipeByExternalId(
          req.userId,
          String(id),
        );
        if (existing) {
          await respond(200, existing);
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

        await respond(201, saved);
      } catch (error) {
        if (error instanceof CatalogQuotaError) {
          sendError(res, 402, error.message, ErrorCode.CATALOG_QUOTA_EXCEEDED);
          return;
        }
        // Handle TOCTOU race: concurrent save creates duplicate — return existing
        if (isUniqueViolation(error)) {
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
