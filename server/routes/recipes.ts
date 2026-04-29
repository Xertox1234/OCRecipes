import type { Express, Response } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth";
import { sendError } from "../lib/api-errors";
import { ErrorCode } from "@shared/constants/error-codes";
import {
  generateFullRecipe,
  generateAndPatchRecipeImage,
  normalizeProductName,
} from "../services/recipe-generation";
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
  parseQueryString,
} from "./_helpers";
import { stripAuthorId, stripAuthorIdOne } from "./_recipe-helpers";
import { recipeGenerationSchema } from "@shared/schemas/recipe";
import { inferMealTypes } from "../services/meal-type-inference";
import { resolveSubscriptionTierFeatures } from "../services/subscription-tier-cache";

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
        handleRouteError(res, error, "fetch featured recipes");
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
        handleRouteError(res, error, "fetch community recipes");
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
        const features = await resolveSubscriptionTierFeatures(req.userId);

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
        handleRouteError(res, error, "fetch generation status");
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
          shareToPublic,
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

        // Compute meal types at the route layer (storage-layer purity — M4)
        const mealTypes = inferMealTypes(
          generatedRecipe.title,
          (generatedRecipe.ingredients ?? []).map((i) => i.name),
        );

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
            mealTypes,
            instructions: generatedRecipe.instructions,
            ingredients: generatedRecipe.ingredients,
            imageUrl: generatedRecipe.imageUrl,
            isPublic: shareToPublic ?? false,
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

        // Kick off image generation after responding — adds 5-30s if awaited here.
        // generateAndPatchRecipeImage updates the DB row when the image is ready.
        void generateAndPatchRecipeImage(
          recipe.id,
          generatedRecipe.title,
          productName,
        );
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
        handleRouteError(res, error, "update recipe sharing");
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
        handleRouteError(res, error, "fetch user recipes");
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

        res.json(stripAuthorIdOne(recipe));
      } catch (error) {
        handleRouteError(res, error, "fetch recipe");
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
        handleRouteError(res, error, "delete recipe");
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
