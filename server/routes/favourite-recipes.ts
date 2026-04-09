import type { Express, Response } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth";
import { sendError } from "../lib/api-errors";
import { ErrorCode } from "@shared/constants/error-codes";
import {
  formatZodError,
  handleRouteError,
  parseQueryInt,
  parseStringParam,
} from "./_helpers";
import { crudRateLimit } from "./_rate-limiters";

const toggleFavouriteSchema = z.object({
  recipeId: z.number().int().positive(),
  recipeType: z.enum(["mealPlan", "community"]),
});

const checkFavouriteQuerySchema = z.object({
  recipeId: z.coerce.number().int().positive(),
  recipeType: z.enum(["mealPlan", "community"]),
});

export function register(app: Express): void {
  app.get(
    "/api/favourite-recipes",
    requireAuth,
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      try {
        const limit = parseQueryInt(req.query.limit, {
          default: 50,
          min: 1,
          max: 100,
        });
        const recipes = await storage.getResolvedFavouriteRecipes(
          req.userId,
          limit,
        );
        res.json(recipes);
      } catch (error) {
        handleRouteError(res, error, "list favourite recipes");
      }
    },
  );

  app.post(
    "/api/favourite-recipes/toggle",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      try {
        const parsed = toggleFavouriteSchema.safeParse(req.body);
        if (!parsed.success) {
          sendError(
            res,
            400,
            formatZodError(parsed.error),
            ErrorCode.VALIDATION_ERROR,
          );
          return;
        }
        const result = await storage.toggleFavouriteRecipe(
          req.userId,
          parsed.data.recipeId,
          parsed.data.recipeType,
        );
        if (result === null) {
          sendError(
            res,
            403,
            "Favourite recipe limit reached. Upgrade to premium for unlimited favourites.",
            ErrorCode.LIMIT_REACHED,
          );
          return;
        }
        res.json({ favourited: result });
      } catch (error) {
        handleRouteError(res, error, "toggle favourite recipe");
      }
    },
  );

  app.get(
    "/api/favourite-recipes/check",
    requireAuth,
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      try {
        const parsed = checkFavouriteQuerySchema.safeParse(req.query);
        if (!parsed.success) {
          sendError(
            res,
            400,
            formatZodError(parsed.error),
            ErrorCode.VALIDATION_ERROR,
          );
          return;
        }
        const favourited = await storage.isRecipeFavourited(
          req.userId,
          parsed.data.recipeId,
          parsed.data.recipeType,
        );
        res.json({ favourited });
      } catch (error) {
        handleRouteError(res, error, "check favourite recipe");
      }
    },
  );

  app.get(
    "/api/favourite-recipes/ids",
    requireAuth,
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      try {
        const ids = await storage.getUserFavouriteRecipeIds(req.userId);
        res.json({ ids });
      } catch (error) {
        handleRouteError(res, error, "get favourite recipe IDs");
      }
    },
  );

  // GET /api/recipes/:recipeType/:recipeId/share — share payload
  app.get(
    "/api/recipes/:recipeType/:recipeId/share",
    requireAuth,
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

        const rawId = parseStringParam(req.params.recipeId);
        const recipeId = rawId ? parseInt(rawId, 10) : NaN;
        if (Number.isNaN(recipeId) || recipeId <= 0) {
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
