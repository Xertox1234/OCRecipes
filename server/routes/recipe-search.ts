import type { Express, Response } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth";
import { sendError } from "../lib/api-errors";
import { ErrorCode } from "@shared/constants/error-codes";
import { searchRecipes } from "../services/recipe-search";
import { logger, toError } from "../lib/logger";
import { instructionsRateLimit } from "./_rate-limiters";
import { formatZodError } from "./_helpers";
import { stripAuthorId } from "./_recipe-helpers";

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

const browseQuerySchema = z.object({
  query: z.string().max(200).optional(),
  cuisine: z.string().max(50).optional(),
  diet: z.string().max(50).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  mealType: z.enum(["breakfast", "lunch", "dinner", "snack"]).optional(),
});

export function register(app: Express): void {
  // GET /api/recipes/search - Unified recipe search (MiniSearch)
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
}
