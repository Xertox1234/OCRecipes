import type { Express, Request, Response } from "express";
import {
  micronutrientRateLimit,
  checkPremiumFeature,
  parsePositiveIntParam,
  parseQueryString,
} from "./_helpers";
import { sendError } from "../lib/api-errors";
import { ErrorCode } from "@shared/constants/error-codes";
import { requireAuth } from "../middleware/auth";
import {
  lookupMicronutrientsWithCache,
  batchLookupMicronutrients,
  aggregateMicronutrients,
  getDailyValueReference,
} from "../services/micronutrient-lookup";
import { storage } from "../storage";

export function register(app: Express): void {
  // GET /api/micronutrients/item/:id — Get micronutrients for a specific scanned item
  app.get(
    "/api/micronutrients/item/:id",
    requireAuth,
    micronutrientRateLimit,
    async (req: Request, res: Response) => {
      try {
        const features = await checkPremiumFeature(
          req,
          res,
          "micronutrientTracking",
          "Micronutrient Tracking",
        );
        if (!features) return;

        const itemId = parsePositiveIntParam(req.params.id);
        if (!itemId)
          return sendError(
            res,
            400,
            "Invalid item ID",
            ErrorCode.VALIDATION_ERROR,
          );

        const item = await storage.getScannedItem(itemId);
        if (!item)
          return sendError(res, 404, "Item not found", ErrorCode.NOT_FOUND);
        if (item.userId !== req.userId)
          return sendError(res, 404, "Item not found", ErrorCode.NOT_FOUND);

        const micronutrients = await lookupMicronutrientsWithCache(
          item.productName,
        );
        res.json({ itemId, productName: item.productName, micronutrients });
      } catch (error) {
        console.error("Get item micronutrients error:", error);
        sendError(
          res,
          500,
          "Failed to get micronutrients",
          ErrorCode.INTERNAL_ERROR,
        );
      }
    },
  );

  // GET /api/micronutrients/daily — Get aggregated daily micronutrient summary
  app.get(
    "/api/micronutrients/daily",
    requireAuth,
    micronutrientRateLimit,
    async (req: Request, res: Response) => {
      try {
        const features = await checkPremiumFeature(
          req,
          res,
          "micronutrientTracking",
          "Micronutrient Tracking",
        );
        if (!features) return;

        const dateStr = parseQueryString(req.query.date);
        const date = dateStr ? new Date(dateStr) : new Date();

        // Get daily logs for the date
        const logs = await storage.getDailyLogs(req.userId!, date);

        // Batch-fetch all scanned items in a single query (fixes N+1)
        const scannedItemIds = [
          ...new Set(
            logs
              .map((log) => log.scannedItemId)
              .filter((id): id is number => id !== null),
          ),
        ];
        const items = await storage.getScannedItemsByIds(
          scannedItemIds,
          req.userId!,
        );
        const foodNames = items.map((item) => item.productName);

        // Batch lookup micronutrients with caching (parallel, cached)
        const micronutrientArrays = await batchLookupMicronutrients(foodNames);

        const aggregated = aggregateMicronutrients(micronutrientArrays);
        res.json({
          date: date.toISOString().split("T")[0],
          micronutrients: aggregated,
        });
      } catch (error) {
        console.error("Get daily micronutrients error:", error);
        sendError(
          res,
          500,
          "Failed to get daily micronutrients",
          ErrorCode.INTERNAL_ERROR,
        );
      }
    },
  );

  // GET /api/micronutrients/reference — Get daily value reference
  app.get(
    "/api/micronutrients/reference",
    requireAuth,
    (_req: Request, res: Response) => {
      res.json(getDailyValueReference());
    },
  );
}
