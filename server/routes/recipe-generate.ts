import type { Express, Response } from "express";
import { z } from "zod";
import { rateLimit } from "express-rate-limit";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth";
import { sendError } from "../lib/api-errors";
import { generateRecipeContent } from "../services/recipe-generation";
import { createServiceLogger } from "../lib/logger";
import type {
  ImportedRecipeData,
  ParsedIngredient,
} from "@shared/types/recipe-import";

const log = createServiceLogger("recipe-generate");

const generatePromptSchema = z.object({
  prompt: z.string().min(3).max(500),
});

const generateRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: {
    error: "Too many recipe generation requests. Please wait.",
    code: "RATE_LIMITED",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

export function register(app: Express): void {
  // POST /api/meal-plan/recipes/generate — Generate a recipe from a prompt (no DB save)
  app.post(
    "/api/meal-plan/recipes/generate",
    requireAuth,
    generateRateLimit,
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      const parsed = generatePromptSchema.safeParse(req.body);
      if (!parsed.success) {
        sendError(
          res,
          400,
          parsed.error.errors[0]?.message ?? "Invalid request",
        );
        return;
      }

      try {
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
        log.error({ err: error }, "recipe generate endpoint failed");
        sendError(res, 500, "Failed to generate recipe");
      }
    },
  );
}
