import type { Express, Response } from "express";
import { createHash, randomUUID } from "crypto";
import { storage } from "../storage";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth";
import {
  TIER_FEATURES,
  isValidSubscriptionTier,
  applyStreakUnlocks,
  resolveEffectiveTier,
  type SubscriptionStatus,
  type PremiumFeatureKey,
} from "@shared/types/premium";
import { resolveVerificationStreak } from "../services/verification-streak-cache";
import { invalidateCache as invalidateTierCache } from "../services/subscription-tier-cache";
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
        // The subscription record and verification streak are independent
        // reads — fetch them concurrently to avoid a serial round-trip.
        const [subscriptionData, streak] = await Promise.all([
          storage.getSubscriptionStatus(req.userId),
          resolveVerificationStreak(req.userId),
        ]);

        if (!subscriptionData) {
          return sendError(res, 404, "User not found", ErrorCode.NOT_FOUND);
        }

        const tier = isValidSubscriptionTier(subscriptionData.tier)
          ? subscriptionData.tier
          : "free";
        const expiresAt = subscriptionData.expiresAt;

        // Downgrade an expired-premium subscription to free (shared helper).
        const { effectiveTier, isActive } = resolveEffectiveTier(
          tier,
          expiresAt,
        );

        // Derive verification-streak unlocks on top of the base tier features.
        const baseFeatures = TIER_FEATURES[effectiveTier];
        const features = applyStreakUnlocks(baseFeatures, streak);
        // Features that the streak unlock granted on top of the base tier —
        // computed by diffing so it stays correct if applyStreakUnlocks grows.
        const streakUnlocks = (
          Object.keys(features) as PremiumFeatureKey[]
        ).filter((key) => features[key] !== baseFeatures[key]);

        const response: SubscriptionStatus = {
          tier: effectiveTier,
          expiresAt: expiresAt?.toISOString() || null,
          features,
          isActive,
          streakUnlocks,
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

        // Evict the cached tier so the upgrade takes effect immediately
        // instead of after the 60s TTL.
        invalidateTierCache(req.userId);

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

        // Evict the cached tier so the restored subscription takes effect
        // immediately instead of after the 60s TTL.
        invalidateTierCache(req.userId);

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
