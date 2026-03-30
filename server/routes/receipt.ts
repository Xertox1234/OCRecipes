import type { Express, Response } from "express";
import { z } from "zod";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth";
import { storage } from "../storage";
import { sendError } from "../lib/api-errors";
import { ErrorCode } from "@shared/constants/error-codes";
import {
  analyzeReceiptPhotos,
  type ReceiptAnalysisResult,
} from "../services/receipt-analysis";
import {
  checkPremiumFeature,
  checkAiConfigured,
  createRateLimiter,
  crudRateLimit,
  createImageUpload,
  formatZodError,
} from "./_helpers";
import { detectImageMimeType } from "../lib/image-mime";
import { logger, toError } from "../lib/logger";

const receiptRateLimit = createRateLimiter({
  windowMs: 60 * 1000,
  max: 5,
  message: "Too many receipt scan requests. Please wait.",
});

const receiptUpload = createImageUpload(5 * 1024 * 1024);

const confirmItemSchema = z.object({
  name: z.string().min(1).max(200),
  quantity: z.number().min(0).max(9999).default(1),
  unit: z.string().max(50).optional(),
  category: z.string().max(50).default("other"),
  estimatedShelfLifeDays: z.number().int().min(1).max(730),
});

const confirmSchema = z.object({
  items: z.array(confirmItemSchema).min(1).max(200),
});

export function register(app: Express): void {
  // POST /api/receipt/scan — Upload 1-3 receipt photos, analyze and extract items
  app.post(
    "/api/receipt/scan",
    requireAuth,
    receiptRateLimit,
    receiptUpload.array("photos", 3),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const features = await checkPremiumFeature(
          req,
          res,
          "receiptScanner",
          "Receipt Scanner",
        );
        if (!features) return;

        const files = req.files as Express.Multer.File[] | undefined;
        if (!files || files.length === 0) {
          return sendError(
            res,
            400,
            "No photos provided",
            ErrorCode.VALIDATION_ERROR,
          );
        }

        // Check monthly scan cap
        const monthlyCount = await storage.getMonthlyReceiptScanCount(
          req.userId,
          new Date(),
        );
        if (monthlyCount >= features.monthlyReceiptScans) {
          return sendError(
            res,
            429,
            `Monthly receipt scan limit reached (${features.monthlyReceiptScans} scans/month)`,
            ErrorCode.RATE_LIMITED,
          );
        }

        // Validate magic bytes for all uploaded images
        for (const file of files) {
          if (!detectImageMimeType(file.buffer)) {
            return sendError(
              res,
              400,
              "Invalid image content. Only JPEG, PNG, and WebP allowed.",
              ErrorCode.VALIDATION_ERROR,
            );
          }
        }

        if (!checkAiConfigured(res)) return;

        const imagesBase64 = files.map((f) => f.buffer.toString("base64"));

        let result: ReceiptAnalysisResult;
        try {
          result = await analyzeReceiptPhotos(imagesBase64);
        } catch (error) {
          // Record failed attempt (doesn't count against cap)
          await storage.createReceiptScan({
            userId: req.userId,
            itemCount: 0,
            photoCount: files.length,
            status: "failed",
          });
          throw error;
        }

        // Determine status based on extraction quality
        const status =
          result.overallConfidence < 0.3
            ? "failed"
            : result.isPartialExtraction
              ? "partial"
              : "completed";

        // Record the scan
        await storage.createReceiptScan({
          userId: req.userId,
          itemCount: result.items.length,
          photoCount: files.length,
          status,
        });

        res.json(result);
      } catch (error) {
        logger.error({ err: toError(error) }, "receipt scan error");
        sendError(
          res,
          500,
          "Failed to analyze receipt",
          ErrorCode.INTERNAL_ERROR,
        );
      }
    },
  );

  // POST /api/receipt/confirm — Accept reviewed items and bulk-add to pantry
  app.post(
    "/api/receipt/confirm",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const features = await checkPremiumFeature(
          req,
          res,
          "receiptScanner",
          "Receipt Scanner",
        );
        if (!features) return;

        const parsed = confirmSchema.safeParse(req.body);
        if (!parsed.success) {
          return sendError(
            res,
            400,
            formatZodError(parsed.error),
            ErrorCode.VALIDATION_ERROR,
          );
        }

        const now = new Date();
        const pantryItems = parsed.data.items.map((item) => {
          const expiresAt = new Date(now);
          expiresAt.setDate(expiresAt.getDate() + item.estimatedShelfLifeDays);
          return {
            userId: req.userId,
            name: item.name,
            quantity: item.quantity.toString(),
            unit: item.unit ?? null,
            category: item.category,
            expiresAt,
          };
        });

        const created = await storage.createPantryItems(pantryItems);

        res.json({ added: created.length, items: created });
      } catch (error) {
        logger.error({ err: toError(error) }, "receipt confirm error");
        sendError(
          res,
          500,
          "Failed to add items to pantry",
          ErrorCode.INTERNAL_ERROR,
        );
      }
    },
  );

  // GET /api/receipt/scan-count — Monthly scan count and limit
  app.get(
    "/api/receipt/scan-count",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const features = await checkPremiumFeature(
          req,
          res,
          "receiptScanner",
          "Receipt Scanner",
        );
        if (!features) return;

        const count = await storage.getMonthlyReceiptScanCount(
          req.userId,
          new Date(),
        );

        res.json({
          count,
          limit: features.monthlyReceiptScans,
          remaining: Math.max(0, features.monthlyReceiptScans - count),
        });
      } catch (error) {
        logger.error({ err: toError(error) }, "receipt scan count error");
        sendError(
          res,
          500,
          "Failed to get scan count",
          ErrorCode.INTERNAL_ERROR,
        );
      }
    },
  );
}
