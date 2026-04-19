import type { Express, Response } from "express";
import { storage } from "../storage";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth";
import { sendError } from "../lib/api-errors";
import { ErrorCode } from "@shared/constants/error-codes";
import { generateRecipeImage } from "../services/recipe-generation";
import { fireAndForget } from "../lib/fire-and-forget";
import { inferMealTypes } from "../services/meal-type-inference";
import { importRecipeFromUrl } from "../services/recipe-import";
import {
  normalizeTitle,
  normalizeDescription,
  normalizeInstructions,
  normalizeIngredient,
} from "../lib/recipe-normalization";
import { urlImportRateLimit } from "./_rate-limiters";
import {
  checkPremiumFeature,
  formatZodError,
  handleRouteError,
} from "./_helpers";
import { importUrlSchema } from "@shared/schemas/recipe";

export function register(app: Express): void {
  // POST /api/meal-plan/recipes/parse-url — Parse recipe from URL without saving
  app.post(
    "/api/meal-plan/recipes/parse-url",
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
          const code =
            result.error in ErrorCode
              ? ErrorCode[result.error as keyof typeof ErrorCode]
              : ErrorCode.VALIDATION_ERROR;
          sendError(res, 422, messages[result.error] || "Import failed", code);
          return;
        }

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

        // Normalize imported data before returning to client
        data.title = normalizeTitle(data.title);
        data.description = normalizeDescription(data.description ?? null) ?? "";
        if (data.instructions) {
          data.instructions = normalizeInstructions(data.instructions);
        }

        res.status(200).json(data);
      } catch (error) {
        handleRouteError(res, error, "parse recipe from URL");
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
        // Gate before triggering fire-and-forget Runware/DALL-E image generation
        const features = await checkPremiumFeature(
          req,
          res,
          "urlImport",
          "URL import",
        );
        if (!features) return;

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
          const code =
            result.error in ErrorCode
              ? ErrorCode[result.error as keyof typeof ErrorCode]
              : ErrorCode.VALIDATION_ERROR;
          sendError(res, 422, messages[result.error] || "Import failed", code);
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
        handleRouteError(res, error, "import recipe from URL");
      }
    },
  );
}
