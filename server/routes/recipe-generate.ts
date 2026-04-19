import type { Express, Response } from "express";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth";
import { sendError } from "../lib/api-errors";
import { ErrorCode } from "@shared/constants/error-codes";
import { generateRecipeContent } from "../services/recipe-generation";
import { checkPremiumFeature, handleRouteError } from "./_helpers";
import { recipeGenerationRateLimit } from "./_rate-limiters";
import { storage } from "../storage";
import type {
  ImportedRecipeData,
  ParsedIngredient,
} from "@shared/types/recipe-import";
import { generatePromptSchema } from "@shared/schemas/recipe";

export function register(app: Express): void {
  // POST /api/meal-plan/recipes/generate — Generate a recipe from a prompt (no DB save)
  app.post(
    "/api/meal-plan/recipes/generate",
    requireAuth,
    recipeGenerationRateLimit,
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      try {
        // Premium gate — mirrors POST /api/recipes/generate. Both endpoints
        // call the AI generator and must be restricted to premium users.
        const features = await checkPremiumFeature(
          req,
          res,
          "recipeGeneration",
          "Recipe generation",
        );
        if (!features) return;

        // Non-transactional fast-path quota check to avoid the expensive
        // AI call when clearly over limit. Re-checked atomically below.
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

        const parsed = generatePromptSchema.safeParse(req.body);
        if (!parsed.success) {
          sendError(
            res,
            400,
            parsed.error.errors[0]?.message ?? "Invalid request",
            ErrorCode.VALIDATION_ERROR,
          );
          return;
        }

        // Fetch user profile so allergens/diet preferences are honored by
        // the AI generator — sibling /api/recipes/generate does the same.
        const userProfile = await storage.getUserProfile(req.userId);

        const content = await generateRecipeContent({
          productName: parsed.data.prompt,
          userProfile,
        });

        // Atomic re-check + log. Even though this endpoint does not persist
        // the recipe, the AI call burns MODEL_HEAVY tokens and must count
        // against the daily quota (H1 from 2026-04-18 audit). Without this
        // the quota check at the top always reads 0 and the user can call
        // unlimited generations. recipeId is null for preview.
        const logged = await storage.logRecipeGenerationWithLimitCheck(
          req.userId,
          features.dailyRecipeGenerations,
          null,
        );
        if (!logged) {
          sendError(
            res,
            429,
            "Daily recipe generation limit reached",
            ErrorCode.DAILY_LIMIT_REACHED,
          );
          return;
        }

        const ingredients: ParsedIngredient[] = content.ingredients.map(
          (ing) => ({
            name: ing.name,
            quantity: ing.quantity || null,
            unit: ing.unit || null,
          }),
        );

        const cookTimeMinutes = parseInt(content.timeEstimate, 10) || null;

        const result: ImportedRecipeData = {
          title: content.title,
          description: content.description ?? null,
          servings: null,
          prepTimeMinutes: null,
          cookTimeMinutes,
          cuisine: null,
          dietTags: content.dietTags,
          ingredients,
          instructions: content.instructions,
          imageUrl: null,
          caloriesPerServing: null,
          proteinPerServing: null,
          carbsPerServing: null,
          fatPerServing: null,
          sourceUrl: "",
        };

        res.json(result);
      } catch (error) {
        handleRouteError(res, error, "recipe generate endpoint failed");
      }
    },
  );
}
