import type { Express, Response } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth";
import { sendError } from "../lib/api-errors";
import { ErrorCode } from "@shared/constants/error-codes";
import { fireAndForget } from "../lib/fire-and-forget";
import { handleRouteError } from "./_helpers";
import { crudRateLimit } from "./_rate-limiters";

const setPicksSchema = z.object({
  recipeIds: z.array(z.number().int().positive()).max(500),
});

const candidatesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  dietType: z.string().optional(),
});

export function register(app: Express): void {
  // GET /api/taste-picks/candidates
  app.get(
    "/api/taste-picks/candidates",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const query = candidatesQuerySchema.safeParse(req.query);
        if (!query.success) {
          return sendError(
            res,
            400,
            "Invalid query params",
            ErrorCode.VALIDATION_ERROR,
          );
        }

        // dietType from query param takes precedence over stored profile
        let dietType: string | null | undefined = query.data.dietType;
        if (!dietType) {
          const profile = await storage.getUserProfile(req.userId);
          dietType = profile?.dietType ?? null;
        }

        const result = await storage.getTastePickCandidates({
          page: query.data.page,
          limit: query.data.limit,
          dietType,
        });

        res.json(result);
      } catch (error) {
        handleRouteError(res, error, "taste-picks:candidates");
      }
    },
  );

  // GET /api/taste-picks
  app.get(
    "/api/taste-picks",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const picks = await storage.getTastePicks(req.userId);
        res.json({ picks });
      } catch (error) {
        handleRouteError(res, error, "taste-picks:get");
      }
    },
  );

  // PUT /api/taste-picks
  app.put(
    "/api/taste-picks",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const parsed = setPicksSchema.safeParse(req.body);
        if (!parsed.success) {
          return sendError(
            res,
            400,
            "recipeIds must be an array of integers",
            ErrorCode.VALIDATION_ERROR,
          );
        }

        const result = await storage.setTastePicks(
          req.userId,
          parsed.data.recipeIds,
        );

        // Mirror cache invalidation from profile.ts — cuisinePreferences changed
        fireAndForget(
          "taste-picks-cache-invalidation",
          storage.invalidateSuggestionCacheForUser(req.userId),
        );

        res.json(result);
      } catch (error) {
        handleRouteError(res, error, "taste-picks:put");
      }
    },
  );
}
