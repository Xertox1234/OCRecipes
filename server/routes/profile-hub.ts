import type { Express, Response } from "express";
import { type AuthenticatedRequest, requireAuth } from "../middleware/auth";
import { storage } from "../storage";
import { createRateLimiter } from "./_rate-limiters";
import { handleRouteError } from "./_helpers";
import { sendError } from "../lib/api-errors";
import { ErrorCode } from "@shared/constants/error-codes";
import { getProfileWidgets } from "../services/profile-hub";

const hubRateLimit = createRateLimiter({
  windowMs: 60 * 1000,
  max: 15,
  message: "Too many profile requests. Please wait.",
});

export function register(app: Express): void {
  // ── Widget data (calorie budget) ─────────────────────────────────────────
  app.get(
    "/api/profile/widgets",
    requireAuth,
    hubRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const data = await getProfileWidgets(req.userId);
        if (!data)
          return sendError(res, 404, "User not found", ErrorCode.NOT_FOUND);
        res.json(data);
      } catch (error) {
        handleRouteError(res, error, "get profile widgets");
      }
    },
  );

  // ── Library counts (single SQL with subselects) ─────────────────────────
  app.get(
    "/api/profile/library-counts",
    requireAuth,
    hubRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const counts = await storage.getLibraryCounts(req.userId);
        res.json(counts);
      } catch (error) {
        handleRouteError(res, error, "get library counts");
      }
    },
  );
}
