import type { Express, Response } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth";
import { sendError } from "../lib/api-errors";
import { ErrorCode } from "@shared/constants/error-codes";
import {
  generateFullRecipe,
  normalizeProductName,
} from "../services/recipe-generation";
import { logger, toError } from "../lib/logger";
import {
  normalizeTitle,
  normalizeDescription,
  normalizeDifficulty,
  normalizeInstructions,
  normalizeIngredient,
} from "../lib/recipe-normalization";
import { recipeGenerationRateLimit, crudRateLimit } from "./_rate-limiters";
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
import { stripAuthorId } from "./_recipe-helpers";

// Zod schemas for community CRUD endpoints
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
