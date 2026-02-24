import type { Express, Request, Response } from "express";
import { rateLimit } from "express-rate-limit";
import { ipKeyGenerator, checkPremiumFeature } from "./_helpers";
import { requireAuth } from "../middleware/auth";
import {
  lookupMicronutrients,
  aggregateMicronutrients,
  getDailyValueReference,
} from "../services/micronutrient-lookup";
import { storage } from "../storage";

const micronutrientRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { error: "Too many micronutrient requests. Please wait." },
  keyGenerator: (req) => req.userId || ipKeyGenerator(req),
  standardHeaders: true,
  legacyHeaders: false,
});

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

        const itemId = parseInt(req.params.id as string, 10);
        if (isNaN(itemId) || itemId <= 0)
          return res.status(400).json({ error: "Invalid item ID" });

        const item = await storage.getScannedItem(itemId);
        if (!item) return res.status(404).json({ error: "Item not found" });
        if (item.userId !== req.userId)
          return res.status(404).json({ error: "Item not found" });

        const micronutrients = await lookupMicronutrients(item.productName);
        res.json({ itemId, productName: item.productName, micronutrients });
      } catch (error) {
        console.error("Get item micronutrients error:", error);
        res.status(500).json({ error: "Failed to get micronutrients" });
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

        const dateStr = req.query.date as string;
        const date = dateStr ? new Date(dateStr) : new Date();

        // Get daily logs for the date
        const logs = await storage.getDailyLogs(req.userId!, date);

        // Look up micronutrients for each logged item
        const micronutrientArrays = await Promise.all(
          logs
            .filter((log) => log.scannedItemId)
            .map(async (log) => {
              const item = await storage.getScannedItem(log.scannedItemId!);
              if (!item) return [];
              return lookupMicronutrients(item.productName);
            }),
        );

        const aggregated = aggregateMicronutrients(micronutrientArrays);
        res.json({
          date: date.toISOString().split("T")[0],
          micronutrients: aggregated,
        });
      } catch (error) {
        console.error("Get daily micronutrients error:", error);
        res.status(500).json({ error: "Failed to get daily micronutrients" });
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
