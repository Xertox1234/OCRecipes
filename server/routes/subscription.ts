import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { requireAuth } from "../middleware/auth";
import {
  TIER_FEATURES,
  isValidSubscriptionTier,
  type SubscriptionTier,
  type SubscriptionStatus,
} from "@shared/types/premium";
import { validateReceipt } from "../services/receipt-validation";
import {
  UpgradeRequestSchema,
  RestoreRequestSchema,
} from "@shared/schemas/subscription";
import { sendError } from "../lib/api-errors";
import { subscriptionRateLimit } from "./_helpers";

export function register(app: Express): void {
  app.get(
    "/api/subscription/status",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const subscriptionData = await storage.getSubscriptionStatus(
          req.userId!,
        );

        if (!subscriptionData) {
          return sendError(res, 404, "User not found");
        }

        const tier = isValidSubscriptionTier(subscriptionData.tier)
          ? subscriptionData.tier
          : "free";
        const expiresAt = subscriptionData.expiresAt;

        // Check if premium subscription has expired
        const isActive =
          tier === "free" ||
          (tier === "premium" &&
            (!expiresAt || new Date(expiresAt) > new Date()));

        const effectiveTier: SubscriptionTier = isActive ? tier : "free";

        const response: SubscriptionStatus = {
          tier: effectiveTier,
          expiresAt: expiresAt?.toISOString() || null,
          features: TIER_FEATURES[effectiveTier],
          isActive,
        };

        res.json(response);
      } catch (error) {
        console.error("Error fetching subscription status:", error);
        sendError(res, 500, "Failed to fetch subscription status");
      }
    },
  );

  app.get(
    "/api/subscription/scan-count",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const count = await storage.getDailyScanCount(req.userId!, new Date());
        res.json({ count });
      } catch (error) {
        console.error("Error fetching scan count:", error);
        sendError(res, 500, "Failed to fetch scan count");
      }
    },
  );

  app.post(
    "/api/subscription/upgrade",
    requireAuth,
    subscriptionRateLimit,
    async (req: Request, res: Response) => {
      try {
        const parsed = UpgradeRequestSchema.safeParse(req.body);
        if (!parsed.success) {
          return sendError(res, 400, "Invalid request body");
        }

        const { receipt, platform, productId, transactionId } = parsed.data;

        // Check for duplicate transaction
        const existing = await storage.getTransaction(transactionId);
        if (existing) {
          return sendError(
            res,
            409,
            "Transaction already processed",
            "ALREADY_OWNED",
          );
        }

        // Validate receipt with platform store
        const validation = await validateReceipt(receipt, platform, productId);
        if (!validation.valid) {
          await storage.createTransaction({
            userId: req.userId!,
            transactionId,
            receipt,
            platform,
            productId,
            status: "failed",
          });
          return res.json({
            success: false,
            error: "Receipt validation failed",
            code: validation.errorCode || "UNKNOWN",
          });
        }

        // Store transaction and upgrade user
        await storage.createTransaction({
          userId: req.userId!,
          transactionId,
          receipt,
          platform,
          productId,
          status: "completed",
        });

        const expiresAt = validation.expiresAt || null;
        await storage.updateSubscription(req.userId!, "premium", expiresAt);

        res.json({
          success: true,
          tier: "premium",
          expiresAt: expiresAt?.toISOString() || null,
        });
      } catch (error) {
        console.error("Error processing upgrade:", error);
        sendError(res, 500, "Failed to process upgrade");
      }
    },
  );

  app.post(
    "/api/subscription/restore",
    requireAuth,
    subscriptionRateLimit,
    async (req: Request, res: Response) => {
      try {
        const parsed = RestoreRequestSchema.safeParse(req.body);
        if (!parsed.success) {
          return sendError(res, 400, "Invalid request body");
        }

        const { receipt, platform } = parsed.data;
        const validation = await validateReceipt(receipt, platform);
        if (!validation.valid) {
          return res.json({
            success: false,
            error: "No valid subscription found",
            code: validation.errorCode || "UNKNOWN",
          });
        }

        const restoreId = `restore-${Date.now()}-${req.userId}`;
        await storage.createTransaction({
          userId: req.userId!,
          transactionId: restoreId,
          receipt,
          platform,
          productId: "restore",
          status: "completed",
        });

        const expiresAt = validation.expiresAt || null;
        await storage.updateSubscription(req.userId!, "premium", expiresAt);

        res.json({
          success: true,
          tier: "premium",
          expiresAt: expiresAt?.toISOString() || null,
        });
      } catch (error) {
        console.error("Error restoring purchases:", error);
        sendError(res, 500, "Failed to restore purchases");
      }
    },
  );
}
