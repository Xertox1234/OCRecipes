import type { Express, Response } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth";
import { sendError } from "../lib/api-errors";
import { ErrorCode } from "@shared/constants/error-codes";
import {
  parseUserAllergies,
  type AllergenId,
} from "@shared/constants/allergens";
import {
  generateFullRecipe,
  generateRecipeImage,
  normalizeProductName,
} from "../services/recipe-generation";
import { fireAndForget } from "../lib/fire-and-forget";
import { inferMealTypes } from "../services/meal-type-inference";
import {
  searchCatalogRecipes,
  getCatalogRecipeDetail,
  CatalogQuotaError,
} from "../services/recipe-catalog";
import { importRecipeFromUrl } from "../services/recipe-import";
import { searchRecipes } from "../services/recipe-search";
import { logger, toError } from "../lib/logger";
import {
  normalizeTitle,
  normalizeDescription,
  normalizeDifficulty,
  normalizeInstructions,
  normalizeIngredient,
} from "../lib/recipe-normalization";
import {
  recipeGenerationRateLimit,
  instructionsRateLimit,
  mealPlanRateLimit,
  urlImportRateLimit,
  crudRateLimit,
} from "./_rate-limiters";
import {
  formatZodError,
  handleRouteError,
  parsePositiveIntParam,
  parseQueryInt,
  parseStringParam,
  checkPremiumFeature,
  getPremiumFeatures,
  parseQueryString,
} from "./_helpers";

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

// Zod schemas for recipe endpoints
const recipeGenerationSchema = z.object({
  productName: z.string().min(3).max(200),
  barcode: z.string().max(100).optional().nullable(),
  servings: z.number().int().min(1).max(20).optional(),
  dietPreferences: z.array(z.string().max(50)).max(10).optional(),
  timeConstraint: z.string().max(50).optional(),
});

const recipeShareSchema = z.object({
  isPublic: z.boolean(),
});

const browseQuerySchema = z.object({
  query: z.string().max(200).optional(),
  cuisine: z.string().max(50).optional(),
  diet: z.string().max(50).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  mealType: z.enum(["breakfast", "lunch", "dinner", "snack"]).optional(),
});

const searchQuerySchema = z.object({
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
  source: z.enum(["all", "personal", "community", "spoonacular"]).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const catalogSearchSchema = z.object({
  query: z.string().min(1).max(200),
  cuisine: z.string().max(100).optional(),
  diet: z.string().max(100).optional(),
  type: z.string().max(100).optional(),
  maxReadyTime: z.coerce.number().int().min(1).max(1440).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  number: z.coerce.number().int().min(1).max(50).optional(),
});

const importUrlSchema = z.object({
  url: z
    .string()
    .url()
    .max(2000)
    .refine(
      (url) => /^https?:\/\//.test(url),
      "Only HTTP/HTTPS URLs are supported",
    ),
});

// Strip authorId from public-facing community recipe responses
function stripAuthorId<T extends { authorId?: unknown }>(
  recipes: T[],
): Omit<T, "authorId">[] {
  return recipes.map(({ authorId: _, ...rest }) => rest);
}

export function register(app: Express): void {
  // GET /api/recipes/featured - Get featured public recipes
  app.get(
    "/api/recipes/featured",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      try {
        const limit = parseQueryInt(req.query.limit, {
          default: 12,
          min: 1,
          max: 50,
        });
        const offset = parseQueryInt(req.query.offset, { default: 0, min: 0 });
        const recipes = await storage.getFeaturedRecipes(limit, offset);
        res.json(stripAuthorId(recipes));
      } catch (error) {
        logger.error({ err: toError(error) }, "get featured recipes failed");
        sendError(
          res,
          500,
          "Failed to fetch featured recipes",
          ErrorCode.INTERNAL_ERROR,
        );
      }
    },
  );

  // GET /api/recipes/search - Unified recipe search
  app.get(
    "/api/recipes/search",
    requireAuth,
    instructionsRateLimit,
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      try {
        const parsed = searchQuerySchema.safeParse(req.query);
        if (!parsed.success) {
          sendError(
            res,
            400,
            formatZodError(parsed.error),
            ErrorCode.VALIDATION_ERROR,
          );
          return;
        }

        const result = await searchRecipes(parsed.data, req.userId);
        res.json(result);
      } catch (error) {
        logger.error({ err: toError(error) }, "recipe search failed");
        sendError(
          res,
          500,
          "Failed to search recipes",
          ErrorCode.INTERNAL_ERROR,
        );
      }
    },
  );

  // GET /api/recipes/browse - Unified recipe browse (community + personal)
  app.get(
    "/api/recipes/browse",
    requireAuth,
    instructionsRateLimit,
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      try {
        const parsed = browseQuerySchema.safeParse(req.query);
        if (!parsed.success) {
          sendError(
            res,
            400,
            "Invalid query parameters",
            ErrorCode.VALIDATION_ERROR,
          );
          return;
        }
        const { query, cuisine, diet, limit, mealType } = parsed.data;

        const [result, frequent] = await Promise.all([
          storage.getUnifiedRecipes({
            userId: req.userId,
            query: query || undefined,
            cuisine: cuisine || undefined,
            diet: diet || undefined,
            mealType: mealType || undefined,
            limit,
          }),
          mealType
            ? storage.getFrequentRecipesForMealType(req.userId, mealType)
            : Promise.resolve([]),
        ]);
        res.json({
          community: stripAuthorId(result.community),
          personal: result.personal,
          frequent,
        });
      } catch (error) {
        logger.error({ err: toError(error) }, "browse recipes failed");
        sendError(
          res,
          500,
          "Failed to browse recipes",
          ErrorCode.INTERNAL_ERROR,
        );
      }
    },
  );

  // GET /api/recipes/community - Get community recipes for a product
  app.get(
    "/api/recipes/community",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      try {
        const barcode = parseQueryString(req.query.barcode) || null;
        const productName = parseQueryString(req.query.productName);

        if (!productName) {
          sendError(
            res,
            400,
            "productName is required",
            ErrorCode.VALIDATION_ERROR,
          );
          return;
        }

        const normalizedName = normalizeProductName(productName);
        const recipes = await storage.getCommunityRecipes(
          barcode,
          normalizedName,
        );

        res.json(stripAuthorId(recipes));
      } catch (error) {
        logger.error({ err: toError(error) }, "get community recipes failed");
        sendError(
          res,
          500,
          "Failed to fetch recipes",
          ErrorCode.INTERNAL_ERROR,
        );
      }
    },
  );

  // GET /api/recipes/generation-status - Get user's daily recipe generation count
  app.get(
    "/api/recipes/generation-status",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      try {
        const features = await getPremiumFeatures(req);

        const generationsToday = await storage.getDailyRecipeGenerationCount(
          req.userId,
          new Date(),
        );

        res.json({
          generationsToday,
          dailyLimit: features.dailyRecipeGenerations,
          canGenerate:
            features.recipeGeneration &&
            generationsToday < features.dailyRecipeGenerations,
        });
      } catch (error) {
        logger.error({ err: toError(error) }, "get generation status failed");
        sendError(
          res,
          500,
          "Failed to fetch generation status",
          ErrorCode.INTERNAL_ERROR,
        );
      }
    },
  );

  // POST /api/recipes/generate - Generate a new recipe (premium only)
  app.post(
    "/api/recipes/generate",
    requireAuth,
    recipeGenerationRateLimit,
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      try {
        // Check premium status
        const features = await checkPremiumFeature(
          req,
          res,
          "recipeGeneration",
          "Recipe generation",
        );
        if (!features) return;

        // Early limit check (non-transactional fast path to avoid expensive AI call)
        const generationsToday = await storage.getDailyRecipeGenerationCount(
          req.userId,
          new Date(),
        );

        if (generationsToday >= features.dailyRecipeGenerations) {
          sendError(
            res,
            429,
            "Daily recipe generation limit reached",
            ErrorCode.DAILY_LIMIT_REACHED,
          );
          return;
        }

        // Validate input
        const parsed = recipeGenerationSchema.safeParse(req.body);
        if (!parsed.success) {
          sendError(
            res,
            400,
            formatZodError(parsed.error),
            ErrorCode.VALIDATION_ERROR,
          );
          return;
        }

        const {
          productName,
          barcode,
          servings,
          dietPreferences,
          timeConstraint,
        } = parsed.data;

        // Get user profile for dietary context
        const userProfile = await storage.getUserProfile(req.userId);

        // Generate the recipe (expensive AI call, done before transaction)
        const generatedRecipe = await generateFullRecipe({
          productName,
          barcode,
          servings,
          dietPreferences,
          timeConstraint,
          userProfile,
        });

        // Normalize generated recipe data
        generatedRecipe.title = normalizeTitle(generatedRecipe.title);
        generatedRecipe.description =
          normalizeDescription(generatedRecipe.description) ??
          generatedRecipe.description;
        generatedRecipe.difficulty =
          normalizeDifficulty(generatedRecipe.difficulty) ??
          generatedRecipe.difficulty;
        generatedRecipe.instructions = normalizeInstructions(
          generatedRecipe.instructions,
        );
        if (generatedRecipe.ingredients) {
          generatedRecipe.ingredients = generatedRecipe.ingredients.map((ing) =>
            normalizeIngredient({
              name: ing.name,
              quantity: ing.quantity,
              unit: ing.unit,
            }),
          );
        }

        // Atomically re-check limit + create recipe + log generation in a transaction
        // This prevents TOCTOU race where concurrent requests both pass the early check
        const recipe = await storage.createRecipeWithLimitCheck(
          req.userId,
          features.dailyRecipeGenerations,
          {
            authorId: req.userId,
            barcode: barcode || null,
            normalizedProductName: normalizeProductName(productName),
            title: generatedRecipe.title,
            description: generatedRecipe.description,
            difficulty: generatedRecipe.difficulty,
            timeEstimate: generatedRecipe.timeEstimate,
            servings: servings || 2,
            dietTags: generatedRecipe.dietTags,
            instructions: generatedRecipe.instructions,
            ingredients: generatedRecipe.ingredients,
            imageUrl: generatedRecipe.imageUrl,
            isPublic: false, // Private until user shares
          },
        );

        if (!recipe) {
          sendError(
            res,
            429,
            "Daily recipe generation limit reached",
            ErrorCode.DAILY_LIMIT_REACHED,
          );
          return;
        }

        res.status(201).json(recipe);
      } catch (error) {
        handleRouteError(res, error, "generate recipe");
      }
    },
  );

  // POST /api/recipes/:id/share - Share/unshare a recipe to community
  app.post(
    "/api/recipes/:id/share",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      try {
        const recipeId = parsePositiveIntParam(req.params.id);
        if (!recipeId) {
          sendError(res, 400, "Invalid recipe ID", ErrorCode.VALIDATION_ERROR);
          return;
        }

        const parsed = recipeShareSchema.safeParse(req.body);
        if (!parsed.success) {
          sendError(
            res,
            400,
            formatZodError(parsed.error),
            ErrorCode.VALIDATION_ERROR,
          );
          return;
        }

        const recipe = await storage.updateRecipePublicStatus(
          recipeId,
          req.userId,
          parsed.data.isPublic,
        );

        if (!recipe) {
          sendError(
            res,
            404,
            "Recipe not found or not owned by you",
            ErrorCode.NOT_FOUND,
          );
          return;
        }

        res.json(recipe);
      } catch (error) {
        logger.error({ err: toError(error) }, "recipe share failed");
        sendError(
          res,
          500,
          "Failed to update recipe sharing",
          ErrorCode.INTERNAL_ERROR,
        );
      }
    },
  );

  // GET /api/recipes/mine - Get user's own recipes
  app.get(
    "/api/recipes/mine",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      try {
        const recipes = await storage.getUserRecipes(req.userId);
        res.json(recipes);
      } catch (error) {
        logger.error({ err: toError(error) }, "get user recipes failed");
        sendError(
          res,
          500,
          "Failed to fetch your recipes",
          ErrorCode.INTERNAL_ERROR,
        );
      }
    },
  );

  // GET /api/recipes/:id - Get a specific recipe
  app.get(
    "/api/recipes/:id",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      try {
        const recipeId = parsePositiveIntParam(req.params.id);
        if (!recipeId) {
          sendError(res, 400, "Invalid recipe ID", ErrorCode.VALIDATION_ERROR);
          return;
        }

        const recipe = await storage.getCommunityRecipe(recipeId);

        if (!recipe) {
          sendError(res, 404, "Recipe not found", ErrorCode.NOT_FOUND);
          return;
        }

        // Only show public recipes or recipes owned by the user
        if (!recipe.isPublic && recipe.authorId !== req.userId) {
          sendError(res, 404, "Recipe not found", ErrorCode.NOT_FOUND);
          return;
        }

        const { authorId: _, ...safeRecipe } = recipe;
        res.json(safeRecipe);
      } catch (error) {
        logger.error({ err: toError(error) }, "get recipe failed");
        sendError(res, 500, "Failed to fetch recipe", ErrorCode.INTERNAL_ERROR);
      }
    },
  );

  // DELETE /api/recipes/:id - Delete a recipe (author only)
  app.delete(
    "/api/recipes/:id",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      try {
        const recipeId = parsePositiveIntParam(req.params.id);
        if (!recipeId) {
          sendError(res, 400, "Invalid recipe ID", ErrorCode.VALIDATION_ERROR);
          return;
        }

        const deleted = await storage.deleteCommunityRecipe(
          recipeId,
          req.userId,
        );

        if (!deleted) {
          sendError(
            res,
            404,
            "Recipe not found or not owned by you",
            ErrorCode.NOT_FOUND,
          );
          return;
        }

        res.status(204).send();
      } catch (error) {
        logger.error({ err: toError(error) }, "delete recipe failed");
        sendError(
          res,
          500,
          "Failed to delete recipe",
          ErrorCode.INTERNAL_ERROR,
        );
      }
    },
  );

  // ============================================================================
  // RECIPE CATALOG & URL IMPORT ROUTES
  // ============================================================================

  // GET /api/meal-plan/catalog/search — Spoonacular search
  app.get(
    "/api/meal-plan/catalog/search",
    requireAuth,
    mealPlanRateLimit,
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      try {
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
        logger.error({ err: toError(error) }, "catalog search failed");
        sendError(
          res,
          500,
          "Failed to search recipes",
          ErrorCode.INTERNAL_ERROR,
        );
      }
    },
  );

  // GET /api/meal-plan/catalog/:id — Spoonacular recipe detail (preview)
  app.get(
    "/api/meal-plan/catalog/:id",
    requireAuth,
    mealPlanRateLimit,
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      try {
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
        logger.error({ err: toError(error) }, "catalog detail failed");
        sendError(
          res,
          500,
          "Failed to fetch recipe detail",
          ErrorCode.INTERNAL_ERROR,
        );
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

  // POST /api/meal-plan/recipes/import-url — Import recipe from URL
  app.post(
    "/api/meal-plan/recipes/import-url",
    requireAuth,
    urlImportRateLimit,
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      try {
        const parsed = importUrlSchema.safeParse(req.body);
        if (!parsed.success) {
          sendError(
            res,
            400,
            formatZodError(parsed.error),
            ErrorCode.VALIDATION_ERROR,
          );
          return;
        }

        const result = await importRecipeFromUrl(parsed.data.url);

        if (!result.success) {
          const messages: Record<string, string> = {
            FETCH_FAILED: "Could not fetch the URL",
            NO_RECIPE_DATA: "No recipe data found on this page",
            PARSE_ERROR: "Could not parse recipe data from this page",
            TIMEOUT: "The request timed out while fetching the URL",
            RESPONSE_TOO_LARGE: "The page is too large to import (max 5 MB)",
          };
          sendError(
            res,
            422,
            messages[result.error] || "Import failed",
            result.error,
          );
          return;
        }

        // Quality gate: reject imported recipes with no usable content
        const { data } = result;
        const importHasInstructions =
          data.instructions && data.instructions.length > 0;
        const importHasIngredients =
          data.ingredients && data.ingredients.length > 0;
        if (!importHasInstructions && !importHasIngredients) {
          sendError(
            res,
            422,
            "This recipe has no instructions or ingredients and cannot be imported",
            ErrorCode.VALIDATION_ERROR,
          );
          return;
        }

        // Normalize imported data
        data.title = normalizeTitle(data.title);
        data.description = normalizeDescription(data.description ?? null) ?? "";
        if (data.instructions) {
          data.instructions = normalizeInstructions(data.instructions);
        }

        // Save to DB
        const ingredientData = data.ingredients.map((ing, idx) => {
          const normalized = normalizeIngredient({
            name: ing.name,
            quantity: ing.quantity ?? "",
            unit: ing.unit ?? "",
          });
          return {
            recipeId: 0,
            name: normalized.name,
            quantity: normalized.quantity,
            unit: normalized.unit,
            category: "other" as const,
            displayOrder: idx,
          };
        });
        const recipe = await storage.createMealPlanRecipe(
          {
            userId: req.userId,
            title: data.title,
            description: data.description,
            sourceType: "url_import",
            sourceUrl: data.sourceUrl,
            cuisine: data.cuisine,
            servings: data.servings || 2,
            prepTimeMinutes: data.prepTimeMinutes,
            cookTimeMinutes: data.cookTimeMinutes,
            imageUrl: data.imageUrl,
            instructions: data.instructions ?? undefined,
            dietTags: data.dietTags,
            mealTypes: inferMealTypes(
              data.title,
              data.ingredients.map((i) => i.name),
            ),
            caloriesPerServing: data.caloriesPerServing,
            proteinPerServing: data.proteinPerServing,
            carbsPerServing: data.carbsPerServing,
            fatPerServing: data.fatPerServing,
          },
          ingredientData,
        );

        // Auto-generate image if source had none (async, non-blocking)
        if (!recipe.imageUrl) {
          fireAndForget(
            "recipe-image-gen",
            (async () => {
              const imageUrl = await generateRecipeImage(
                recipe.title,
                recipe.title,
              );
              if (imageUrl) {
                await storage.updateMealPlanRecipe(recipe.id, req.userId, {
                  imageUrl,
                });
              }
            })(),
          );
        }

        res.status(201).json(recipe);
      } catch (error) {
        logger.error({ err: toError(error) }, "URL import failed");
        sendError(
          res,
          500,
          "Failed to import recipe",
          ErrorCode.INTERNAL_ERROR,
        );
      }
    },
  );

  // GET /api/recipes/:recipeType/:recipeId/share — share payload
  app.get(
    "/api/recipes/:recipeType/:recipeId/share",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      try {
        const recipeType = parseStringParam(req.params.recipeType);
        if (recipeType !== "mealPlan" && recipeType !== "community") {
          sendError(
            res,
            400,
            "Invalid recipe type",
            ErrorCode.VALIDATION_ERROR,
          );
          return;
        }

        const recipeId = parsePositiveIntParam(req.params.recipeId);
        if (!recipeId) {
          sendError(res, 400, "Invalid recipe ID", ErrorCode.VALIDATION_ERROR);
          return;
        }

        const payload = await storage.getRecipeSharePayload(
          recipeId,
          recipeType,
          req.userId,
        );
        if (!payload) {
          sendError(res, 404, "Recipe not found", ErrorCode.NOT_FOUND);
          return;
        }

        const deepLink = `ocrecipes://recipe/${recipeId}?type=${recipeType}`;
        res.json({ ...payload, deepLink });
      } catch (error) {
        handleRouteError(res, error, "get recipe share payload");
      }
    },
  );
}
