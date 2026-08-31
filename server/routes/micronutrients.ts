import type { Express, Response } from "express";
import {
  checkPremiumFeature,
  handleRouteError,
  parsePositiveIntParam,
  parseQueryString,
  parseQueryDateString,
  parseTimezone,
} from "./_helpers";
import { micronutrientRateLimit } from "./_rate-limiters";
import { sendError } from "../lib/api-errors";
import { ErrorCode } from "@shared/constants/error-codes";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth";
import {
  lookupMicronutrientsWithCache,
  batchLookupMicronutrients,
  aggregateMicronutrients,
  getDailyValueReference,
} from "../services/micronutrient-lookup";
import { storage } from "../storage";
import { civilDateString, civilDateToInstant } from "../lib/civil-date";

export function register(app: Express): void {
  // GET /api/micronutrients/item/:id — Get micronutrients for a specific scanned item
  app.get(
    "/api/micronutrients/item/:id",
    requireAuth,
    micronutrientRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
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

        const item = await storage.getScannedItem(itemId, req.userId);
        if (!item)
          return sendError(res, 404, "Item not found", ErrorCode.NOT_FOUND);

        const micronutrients = await lookupMicronutrientsWithCache(
          item.productName,
        );
        res.json({ itemId, productName: item.productName, micronutrients });
      } catch (error) {
        handleRouteError(res, error, "get item micronutrients");
      }
    },
  );

  // GET /api/micronutrients/daily — Get aggregated daily micronutrient summary
  app.get(
    "/api/micronutrients/daily",
    requireAuth,
    micronutrientRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const features = await checkPremiumFeature(
          req,
          res,
          "micronutrientTracking",
          "Micronutrient Tracking",
        );
        if (!features) return;

        const tz = parseTimezone(req.headers["x-timezone"]);
        if (
          req.query.date !== undefined &&
          parseQueryDateString(req.query.date) === undefined
        ) {
          sendError(
            res,
            400,
            "date must be a valid yyyy-mm-dd calendar date",
            ErrorCode.VALIDATION_ERROR,
          );
          return;
        }
        // Day-bucketed in the client's timezone so micros cover the same window
        // as the macro summary endpoints. That parity is only real if the
        // calendar date is converted to an instant IN THAT ZONE — the previous
        // `new Date(dateStr)` gave UTC midnight, whose civil day is the previous
        // one at any negative offset, so this endpoint answered for the wrong
        // day for the whole of the Americas. It also 500'd on an unparseable
        // date, since an Invalid Date reaches Intl.format; the guard above ends
        // that too.
        const dateStr =
          parseQueryDateString(req.query.date) ??
          civilDateString(new Date(), tz);
        const date = civilDateToInstant(dateStr, tz);

        const logs = await storage.getDailyLogs(req.userId, date, tz);

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
          req.userId,
        );
        const foodNames = items.map((item) => item.productName);

        // Batch lookup micronutrients with caching (parallel, cached)
        const micronutrientArrays = await batchLookupMicronutrients(foodNames);

        const aggregated = aggregateMicronutrients(micronutrientArrays);
        res.json({
          date: dateStr,
          micronutrients: aggregated,
        });
      } catch (error) {
        handleRouteError(res, error, "get daily micronutrients");
      }
    },
  );

  // GET /api/micronutrients/lookup — Lookup micronutrients by food name (no saved item required)
  app.get(
    "/api/micronutrients/lookup",
    requireAuth,
    micronutrientRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const features = await checkPremiumFeature(
          req,
          res,
          "micronutrientTracking",
          "Micronutrient Tracking",
        );
        if (!features) return;

        const name = parseQueryString(req.query.name);
        if (!name)
          return sendError(
            res,
            400,
            "Missing required query parameter: name",
            ErrorCode.VALIDATION_ERROR,
          );

        const micronutrients = await lookupMicronutrientsWithCache(name);
        res.json({ foodName: name, micronutrients });
      } catch (error) {
        handleRouteError(res, error, "lookup micronutrients");
      }
    },
  );

  // GET /api/micronutrients/reference — Get daily value reference
  app.get(
    "/api/micronutrients/reference",
    requireAuth,
    micronutrientRateLimit,
    (_req: AuthenticatedRequest, res: Response) => {
      res.json(getDailyValueReference());
    },
  );
}
