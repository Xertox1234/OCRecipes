import type { Express, Response } from "express";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth";
import { sendError } from "../lib/api-errors";
import { ErrorCode } from "@shared/constants/error-codes";
import { logger } from "../lib/logger";
import { crudRateLimit } from "./_rate-limiters";
import { handleRouteError } from "./_helpers";
import { isAdmin } from "./_admin";
import { rebuildSearchIndex } from "../services/recipe-search";

export function register(app: Express): void {
  // POST /api/admin/search-index/rebuild — rebuild the in-memory recipe search
  // index from the database. Needed after an out-of-process seed: the seed
  // script's addToIndex only mutates its own throwaway process, so the live
  // server's index stays stale until it restarts or this endpoint runs.
  app.post(
    "/api/admin/search-index/rebuild",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      try {
        if (!isAdmin(req.userId)) {
          sendError(res, 403, "Admin access required", ErrorCode.UNAUTHORIZED);
          return;
        }

        const { total } = await rebuildSearchIndex();

        logger.info(
          { userId: req.userId, action: "rebuild_search_index", total },
          "admin operation",
        );
        res.json({ message: "Search index rebuilt", total });
      } catch (err) {
        handleRouteError(res, err, "rebuild search index");
      }
    },
  );
}
