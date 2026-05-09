import type { Express, Response } from "express";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth";
import { storage } from "../storage";
import { handleRouteError, parseQueryInt } from "./_helpers";
import { crudRateLimit } from "./_rate-limiters";

export function register(app: Express): void {
  app.get(
    "/api/curated-recipes",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      try {
        const limit = parseQueryInt(req.query.limit, {
          default: 20,
          min: 1,
          max: 50,
        });
        const offset = parseQueryInt(req.query.offset, {
          default: 0,
          min: 0,
        });
        const recipes = await storage.getCuratedRecipes({ limit, offset });
        res.json({ recipes });
      } catch (error) {
        handleRouteError(res, error, "list curated recipes");
      }
    },
  );
}
