import type { Express, Response } from "express";
import { storage } from "../storage";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth";
import { sendError } from "../lib/api-errors";
import { ErrorCode } from "@shared/constants/error-codes";
import { crudRateLimit } from "./_rate-limiters";
import { handleRouteError, parsePositiveIntParam } from "./_helpers";

/**
 * Parse :id and gate on public visibility. Sends 400/404 and returns null on
 * failure. 404 (not 403) for a private recipe — even to its author — so the
 * response never confirms the id exists and a private recipe has no community.
 */
async function resolvePublicRecipeId(
  req: AuthenticatedRequest,
  res: Response,
): Promise<number | null> {
  const recipeId = parsePositiveIntParam(req.params.id);
  if (!recipeId) {
    sendError(res, 400, "Invalid recipe ID", ErrorCode.VALIDATION_ERROR);
    return null;
  }
  if (!(await storage.isPublicCommunityRecipe(recipeId))) {
    sendError(res, 404, "Recipe not found", ErrorCode.NOT_FOUND);
    return null;
  }
  return recipeId;
}

/** PUT marks, DELETE unmarks; both idempotent and return the fresh count. */
async function setTried(
  req: AuthenticatedRequest,
  res: Response,
  tried: boolean,
): Promise<void> {
  try {
    const recipeId = await resolvePublicRecipeId(req, res);
    if (recipeId === null) return;
    await storage.setRecipeTried(req.userId, recipeId, tried);
    const stats = await storage.getRecipeCommunityStats(recipeId, req.userId);
    res.json({ tried, triedCount: stats.triedCount });
  } catch (error) {
    handleRouteError(res, error, "set recipe tried");
  }
}

export function register(app: Express): void {
  // Inline arrow (not a bare factory call): the auth-wiring static scan ends
  // its middleware window at the handler's `=>`.
  app.put(
    "/api/recipes/:id/tried",
    requireAuth,
    crudRateLimit,
    (req: AuthenticatedRequest, res: Response) => setTried(req, res, true),
  );

  app.delete(
    "/api/recipes/:id/tried",
    requireAuth,
    crudRateLimit,
    (req: AuthenticatedRequest, res: Response) => setTried(req, res, false),
  );

  app.get(
    "/api/recipes/:id/stats",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      try {
        const recipeId = await resolvePublicRecipeId(req, res);
        if (recipeId === null) return;
        res.json(await storage.getRecipeCommunityStats(recipeId, req.userId));
      } catch (error) {
        handleRouteError(res, error, "fetch recipe stats");
      }
    },
  );

  app.get(
    "/api/recipes/:id/variants",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      try {
        const recipeId = await resolvePublicRecipeId(req, res);
        if (recipeId === null) return;
        res.json({ variants: await storage.getRecipeVariants(recipeId) });
      } catch (error) {
        handleRouteError(res, error, "fetch recipe variants");
      }
    },
  );
}
