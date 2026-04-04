import type { Express, Response } from "express";
import { createHash, randomUUID } from "crypto";
import { storage } from "../storage";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth";
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
import { ErrorCode } from "@shared/constants/error-codes";
import { handleRouteError } from "./_helpers";
import { subscriptionRateLimit } from "./_rate-limiters";

/** Store a hash + truncated prefix instead of the full receipt to avoid DB bloat. */
function compactReceipt(receipt: string): string {
  const hash = createHash("sha256").update(receipt).digest("hex");
  const prefix = receipt.slice(0, 64);
  return `${prefix}...sha256:${hash}`;
}

export function register(app: Express): void {
  app.get(
    "/api/subscription/status",
    requireAuth,
    subscriptionRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const subscriptionData = await storage.getSubscriptionStatus(
          req.userId,
        );

        if (!subscriptionData) {
          return sendError(res, 404, "User not found", ErrorCode.NOT_FOUND);
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
        handleRouteError(res, error, "fetch subscription status");
      }
    },
  );

  app.get(
    "/api/subscription/scan-count",
    requireAuth,
    subscriptionRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const count = await storage.getDailyScanCount(req.userId, new Date());
        res.json({ count });
      } catch (error) {
        handleRouteError(res, error, "fetch scan count");
      }
    },
  );

  app.post(
    "/api/subscription/upgrade",
    requireAuth,
    subscriptionRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const parsed = UpgradeRequestSchema.safeParse(req.body);
        if (!parsed.success) {
          return sendError(
            res,
            400,
            "Invalid request body",
            ErrorCode.VALIDATION_ERROR,
          );
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
            userId: req.userId,
            transactionId,
            receipt: compactReceipt(receipt),
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

        // Atomically store transaction and upgrade user
        const expiresAt = validation.expiresAt || null;
        await storage.createTransactionAndUpgrade(
          {
            userId: req.userId,
            transactionId,
            receipt: compactReceipt(receipt),
            platform,
            productId,
            status: "completed",
          },
          "premium",
          expiresAt,
        );

        res.json({
          success: true,
          tier: "premium",
          expiresAt: expiresAt?.toISOString() || null,
        });
      } catch (error) {
        handleRouteError(res, error, "process upgrade");
      }
    },
  );

  app.post(
    "/api/subscription/restore",
    requireAuth,
    subscriptionRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const parsed = RestoreRequestSchema.safeParse(req.body);
        if (!parsed.success) {
          return sendError(
            res,
            400,
            "Invalid request body",
            ErrorCode.VALIDATION_ERROR,
          );
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

        const restoreId = `restore-${randomUUID()}`;
        const expiresAt = validation.expiresAt || null;
        await storage.createTransactionAndUpgrade(
          {
            userId: req.userId,
            transactionId: restoreId,
            receipt: compactReceipt(receipt),
            platform,
            productId: "restore",
            status: "completed",
          },
          "premium",
          expiresAt,
        );

        res.json({
          success: true,
          tier: "premium",
          expiresAt: expiresAt?.toISOString() || null,
        });
      } catch (error) {
        handleRouteError(res, error, "restore purchases");
      }
    },
  );
}
