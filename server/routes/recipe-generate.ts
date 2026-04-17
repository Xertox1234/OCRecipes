import type { Express, Response } from "express";
import { z } from "zod";
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

const generatePromptSchema = z.object({
  prompt: z.string().min(3).max(500),
});

export function register(app: Express): void {
  // POST /api/meal-plan/recipes/generate — Generate a recipe from a prompt (no DB save)
  app.post(
    "/api/meal-plan/recipes/generate",
    requireAuth,
    recipeGenerationRateLimit,
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      try {
        // Premium gate — same contract as POST /api/recipes/generate
        const features = await checkPremiumFeature(
          req,
          res,
          "recipeGeneration",
          "Recipe generation",
        );
        if (!features) return;

        // Daily quota check
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

        const content = await generateRecipeContent({
          productName: parsed.data.prompt,
          userProfile: null,
        });

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
