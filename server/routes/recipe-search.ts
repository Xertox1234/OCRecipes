import type { Express, Request, Response } from "express";
import { rateLimit } from "express-rate-limit";
import { storage } from "../storage";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth";
import { sendError } from "../lib/api-errors";
import { ErrorCode } from "@shared/constants/error-codes";
import { searchRecipes } from "../services/recipe-search";
import { instructionsRateLimit, ipKeyGenerator } from "./_rate-limiters";
import { formatZodError, handleRouteError } from "./_helpers";
import { stripAuthorId } from "./_recipe-helpers";
import { searchQuerySchema, browseQuerySchema } from "@shared/schemas/recipe";

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
        handleRouteError(res, error, "search recipes");
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
        handleRouteError(res, error, "browse recipes");
      }
    },
  );

  // GET /api/recipes/trending — top popularity-derived search terms (Home drawer)
  app.get(
    "/api/recipes/trending",
    requireAuth,
    // Limiter inlined here (rather than the _rate-limiters factory const used by
    // the sibling routes above) so CodeQL's js/missing-rate-limiting query can
    // trace it — the createRateLimiter factory-const indirection is invisible to
    // its dataflow (the historically-dismissed #146–#215 cluster). Behavior is
    // identical to instructionsRateLimit: 20/min, user-keyed with the same
    // Railway-aware IP fallback (placed after requireAuth so req.userId is set).
    rateLimit({
      windowMs: 60_000,
      max: 20,
      message: {
        error: "Too many trending requests. Please wait.",
        code: "RATE_LIMITED",
      },
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: (req: Request) => req.userId || ipKeyGenerator(req),
    }),
    async (_req: AuthenticatedRequest, res: Response): Promise<void> => {
      try {
        const terms = await storage.getTrendingSearchTerms(8);
        res.json({ terms });
      } catch (error) {
        handleRouteError(res, error, "trending searches");
      }
    },
  );
}
