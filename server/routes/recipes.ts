import type { Express, Request, Response } from "express";
import { z, ZodError } from "zod";
import { storage } from "../storage";
import { requireAuth } from "../middleware/auth";
import { TIER_FEATURES, isValidSubscriptionTier } from "@shared/types/premium";
import {
  generateFullRecipe,
  normalizeProductName,
} from "../services/recipe-generation";
import {
  searchCatalogRecipes,
  getCatalogRecipeDetail,
  CatalogQuotaError,
} from "../services/recipe-catalog";
import { importRecipeFromUrl } from "../services/recipe-import";
import {
  recipeGenerationRateLimit,
  instructionsRateLimit,
  mealPlanRateLimit,
  urlImportRateLimit,
  formatZodError,
  parsePositiveIntParam,
} from "./_helpers";

// Zod schemas for recipe endpoints
const recipeGenerationSchema = z.object({
  productName: z.string().min(1).max(200),
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
  url: z.string().url().max(2000),
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
    async (req: Request, res: Response): Promise<void> => {
      try {
        const limit = Math.min(Number(req.query.limit) || 12, 50);
        const offset = Number(req.query.offset) || 0;
        const recipes = await storage.getFeaturedRecipes(limit, offset);
        res.json(stripAuthorId(recipes));
      } catch (error) {
        console.error("Get featured recipes error:", error);
        res.status(500).json({ error: "Failed to fetch featured recipes" });
      }
    },
  );

  // GET /api/recipes/browse - Unified recipe browse (community + personal)
  app.get(
    "/api/recipes/browse",
    requireAuth,
    instructionsRateLimit,
    async (req: Request, res: Response): Promise<void> => {
      try {
        const parsed = browseQuerySchema.safeParse(req.query);
        if (!parsed.success) {
          res.status(400).json({ error: "Invalid query parameters" });
          return;
        }
        const { query, cuisine, diet, limit } = parsed.data;

        const result = await storage.getUnifiedRecipes({
          userId: req.userId!,
          query: query || undefined,
          cuisine: cuisine || undefined,
          diet: diet || undefined,
          limit,
        });
        res.json({
          community: stripAuthorId(result.community),
          personal: result.personal,
        });
      } catch (error) {
        console.error("Browse recipes error:", error);
        res.status(500).json({ error: "Failed to browse recipes" });
      }
    },
  );

  // GET /api/recipes/community - Get community recipes for a product
  app.get(
    "/api/recipes/community",
    requireAuth,
    async (req: Request, res: Response): Promise<void> => {
      try {
        const barcode = (req.query.barcode as string) || null;
        const productName = req.query.productName as string;

        if (!productName) {
          res.status(400).json({ error: "productName is required" });
          return;
        }

        const normalizedName = normalizeProductName(productName);
        const recipes = await storage.getCommunityRecipes(
          barcode,
          normalizedName,
        );

        res.json(stripAuthorId(recipes));
      } catch (error) {
        console.error("Get community recipes error:", error);
        res.status(500).json({ error: "Failed to fetch recipes" });
      }
    },
  );

  // GET /api/recipes/generation-status - Get user's daily recipe generation count
  app.get(
    "/api/recipes/generation-status",
    requireAuth,
    async (req: Request, res: Response): Promise<void> => {
      try {
        const subscriptionData = await storage.getSubscriptionStatus(
          req.userId!,
        );
        const tierValue = subscriptionData?.tier || "free";
        const tier = isValidSubscriptionTier(tierValue) ? tierValue : "free";
        const features = TIER_FEATURES[tier];

        const generationsToday = await storage.getDailyRecipeGenerationCount(
          req.userId!,
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
        console.error("Get generation status error:", error);
        res.status(500).json({ error: "Failed to fetch generation status" });
      }
    },
  );

  // POST /api/recipes/generate - Generate a new recipe (premium only)
  app.post(
    "/api/recipes/generate",
    requireAuth,
    recipeGenerationRateLimit,
    async (req: Request, res: Response): Promise<void> => {
      try {
        // Check premium status
        const subscriptionData = await storage.getSubscriptionStatus(
          req.userId!,
        );
        const tierValue = subscriptionData?.tier || "free";
        const tier = isValidSubscriptionTier(tierValue) ? tierValue : "free";
        const features = TIER_FEATURES[tier];

        if (!features.recipeGeneration) {
          res.status(403).json({
            error: "PREMIUM_REQUIRED",
            message: "Recipe generation requires a premium subscription",
          });
          return;
        }

        // Check daily limit
        const generationsToday = await storage.getDailyRecipeGenerationCount(
          req.userId!,
          new Date(),
        );

        if (generationsToday >= features.dailyRecipeGenerations) {
          res.status(429).json({
            error: "DAILY_LIMIT_REACHED",
            message: "Daily recipe generation limit reached",
            generationsToday,
            dailyLimit: features.dailyRecipeGenerations,
          });
          return;
        }

        // Validate input
        const parsed = recipeGenerationSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: formatZodError(parsed.error) });
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
        const userProfile = await storage.getUserProfile(req.userId!);

        // Generate the recipe
        const generatedRecipe = await generateFullRecipe({
          productName,
          barcode,
          servings,
          dietPreferences,
          timeConstraint,
          userProfile,
        });

        // Save to database (initially private - user must explicitly share)
        const recipe = await storage.createCommunityRecipe({
          authorId: req.userId!,
          barcode: barcode || null,
          normalizedProductName: normalizeProductName(productName),
          title: generatedRecipe.title,
          description: generatedRecipe.description,
          difficulty: generatedRecipe.difficulty,
          timeEstimate: generatedRecipe.timeEstimate,
          servings: servings || 2,
          dietTags: generatedRecipe.dietTags,
          instructions: generatedRecipe.instructions,
          imageUrl: generatedRecipe.imageUrl,
          isPublic: false, // Private until user shares
        });

        // Log the generation for rate limiting
        await storage.logRecipeGeneration(req.userId!, recipe.id);

        res.status(201).json(recipe);
      } catch (error) {
        if (error instanceof ZodError) {
          res.status(400).json({ error: formatZodError(error) });
          return;
        }
        console.error("Recipe generation error:", error);
        res.status(500).json({ error: "Failed to generate recipe" });
      }
    },
  );

  // POST /api/recipes/:id/share - Share/unshare a recipe to community
  app.post(
    "/api/recipes/:id/share",
    requireAuth,
    async (req: Request, res: Response): Promise<void> => {
      try {
        const recipeId = parsePositiveIntParam(req.params.id as string);
        if (!recipeId) {
          res.status(400).json({ error: "Invalid recipe ID" });
          return;
        }

        const parsed = recipeShareSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: formatZodError(parsed.error) });
          return;
        }

        const recipe = await storage.updateRecipePublicStatus(
          recipeId,
          req.userId!,
          parsed.data.isPublic,
        );

        if (!recipe) {
          res
            .status(404)
            .json({ error: "Recipe not found or not owned by you" });
          return;
        }

        res.json(recipe);
      } catch (error) {
        console.error("Recipe share error:", error);
        res.status(500).json({ error: "Failed to update recipe sharing" });
      }
    },
  );

  // GET /api/recipes/mine - Get user's own recipes
  app.get(
    "/api/recipes/mine",
    requireAuth,
    async (req: Request, res: Response): Promise<void> => {
      try {
        const recipes = await storage.getUserRecipes(req.userId!);
        res.json(recipes);
      } catch (error) {
        console.error("Get user recipes error:", error);
        res.status(500).json({ error: "Failed to fetch your recipes" });
      }
    },
  );

  // GET /api/recipes/:id - Get a specific recipe
  app.get(
    "/api/recipes/:id",
    requireAuth,
    async (req: Request, res: Response): Promise<void> => {
      try {
        const recipeId = parsePositiveIntParam(req.params.id as string);
        if (!recipeId) {
          res.status(400).json({ error: "Invalid recipe ID" });
          return;
        }

        const recipe = await storage.getCommunityRecipe(recipeId);

        if (!recipe) {
          res.status(404).json({ error: "Recipe not found" });
          return;
        }

        // Only show public recipes or recipes owned by the user
        if (!recipe.isPublic && recipe.authorId !== req.userId) {
          res.status(404).json({ error: "Recipe not found" });
          return;
        }

        const { authorId: _, ...safeRecipe } = recipe;
        res.json(safeRecipe);
      } catch (error) {
        console.error("Get recipe error:", error);
        res.status(500).json({ error: "Failed to fetch recipe" });
      }
    },
  );

  // DELETE /api/recipes/:id - Delete a recipe (author only)
  app.delete(
    "/api/recipes/:id",
    requireAuth,
    async (req: Request, res: Response): Promise<void> => {
      try {
        const recipeId = parsePositiveIntParam(req.params.id as string);
        if (!recipeId) {
          res.status(400).json({ error: "Invalid recipe ID" });
          return;
        }

        const deleted = await storage.deleteCommunityRecipe(
          recipeId,
          req.userId!,
        );

        if (!deleted) {
          res
            .status(404)
            .json({ error: "Recipe not found or not owned by you" });
          return;
        }

        res.status(204).send();
      } catch (error) {
        console.error("Delete recipe error:", error);
        res.status(500).json({ error: "Failed to delete recipe" });
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
    async (req: Request, res: Response): Promise<void> => {
      try {
        const parsed = catalogSearchSchema.safeParse(req.query);
        if (!parsed.success) {
          res.status(400).json({ error: formatZodError(parsed.error) });
          return;
        }

        const results = await searchCatalogRecipes(parsed.data);
        res.json(results);
      } catch (error) {
        if (error instanceof CatalogQuotaError) {
          res
            .status(402)
            .json({ error: "CATALOG_QUOTA_EXCEEDED", message: error.message });
          return;
        }
        console.error("Catalog search error:", error);
        res.status(500).json({ error: "Failed to search recipes" });
      }
    },
  );

  // GET /api/meal-plan/catalog/:id — Spoonacular recipe detail (preview)
  app.get(
    "/api/meal-plan/catalog/:id",
    requireAuth,
    mealPlanRateLimit,
    async (req: Request, res: Response): Promise<void> => {
      try {
        const id = parsePositiveIntParam(req.params.id as string);
        if (!id) {
          res.status(400).json({ error: "Invalid catalog ID" });
          return;
        }

        const detail = await getCatalogRecipeDetail(id);
        if (!detail) {
          res.status(404).json({ error: "Recipe not found in catalog" });
          return;
        }

        res.json(detail);
      } catch (error) {
        if (error instanceof CatalogQuotaError) {
          res
            .status(402)
            .json({ error: "CATALOG_QUOTA_EXCEEDED", message: error.message });
          return;
        }
        console.error("Catalog detail error:", error);
        res.status(500).json({ error: "Failed to fetch recipe detail" });
      }
    },
  );

  // POST /api/meal-plan/catalog/:id/save — Save catalog recipe to DB
  app.post(
    "/api/meal-plan/catalog/:id/save",
    requireAuth,
    mealPlanRateLimit,
    async (req: Request, res: Response): Promise<void> => {
      try {
        const id = parsePositiveIntParam(req.params.id as string);
        if (!id) {
          res.status(400).json({ error: "Invalid catalog ID" });
          return;
        }

        // Dedup: check if already saved
        const existing = await storage.findMealPlanRecipeByExternalId(
          req.userId!,
          String(id),
        );
        if (existing) {
          res.json(existing);
          return;
        }

        // Fetch from Spoonacular
        const detail = await getCatalogRecipeDetail(id);
        if (!detail) {
          res.status(404).json({ error: "Recipe not found in catalog" });
          return;
        }

        // Set the userId and save
        detail.recipe.userId = req.userId!;
        const saved = await storage.createMealPlanRecipe(
          detail.recipe,
          detail.ingredients,
        );

        res.status(201).json(saved);
      } catch (error) {
        if (error instanceof CatalogQuotaError) {
          res
            .status(402)
            .json({ error: "CATALOG_QUOTA_EXCEEDED", message: error.message });
          return;
        }
        console.error("Catalog save error:", error);
        res.status(500).json({ error: "Failed to save catalog recipe" });
      }
    },
  );

  // POST /api/meal-plan/recipes/import-url — Import recipe from URL
  app.post(
    "/api/meal-plan/recipes/import-url",
    requireAuth,
    urlImportRateLimit,
    async (req: Request, res: Response): Promise<void> => {
      try {
        const parsed = importUrlSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: formatZodError(parsed.error) });
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
          res.status(422).json({
            error: result.error,
            message: messages[result.error] || "Import failed",
          });
          return;
        }

        // Save to DB
        const { data } = result;
        const recipe = await storage.createMealPlanRecipe(
          {
            userId: req.userId!,
            title: data.title,
            description: data.description,
            sourceType: "url_import",
            sourceUrl: data.sourceUrl,
            cuisine: data.cuisine,
            servings: data.servings || 2,
            prepTimeMinutes: data.prepTimeMinutes,
            cookTimeMinutes: data.cookTimeMinutes,
            imageUrl: data.imageUrl,
            instructions: data.instructions,
            dietTags: data.dietTags,
            caloriesPerServing: data.caloriesPerServing,
            proteinPerServing: data.proteinPerServing,
            carbsPerServing: data.carbsPerServing,
            fatPerServing: data.fatPerServing,
          },
          data.ingredients.map((ing, idx) => ({
            recipeId: 0,
            name: ing.name,
            quantity: ing.quantity,
            unit: ing.unit,
            category: "other",
            displayOrder: idx,
          })),
        );

        res.status(201).json(recipe);
      } catch (error) {
        console.error("URL import error:", error);
        res.status(500).json({ error: "Failed to import recipe" });
      }
    },
  );
}
