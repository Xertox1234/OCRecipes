import type { Express, Response } from "express";
import { createHash } from "crypto";
import { storage } from "../storage";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth";
import { createServiceLogger } from "../lib/logger";
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
import {
  validateReceipt,
  type ReceiptValidationResult,
} from "../services/receipt-validation";
import {
  UpgradeRequestSchema,
  RestoreRequestSchema,
  type Platform,
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

const log = createServiceLogger("subscription");

/**
 * Grant or refresh the premium entitlement from an already-validated receipt.
 * Entitlement is keyed on the receipt's STABLE id (`originalTransactionId`,
 * derived server-side) — never the client-supplied transactionId or a random
 * one — so a replayed receipt cannot grant premium to a second account. Shared
 * by /upgrade and /restore so the invariant holds at every write site.
 */
async function applyValidatedReceipt(
  res: Response,
  userId: string,
  receipt: string,
  platform: Platform,
  validation: ReceiptValidationResult,
): Promise<void> {
  // Fail closed: a valid receipt with no stable id must NOT grant entitlement.
  // Falling back to a synthetic/random id would re-open receipt sharing — the
  // exact vulnerability this guards against.
  if (!validation.originalTransactionId) {
    log.error(
      { platform, productId: validation.productId },
      "valid receipt has no originalTransactionId — refusing to grant entitlement",
    );
    res.json({
      success: false,
      error:
        "Could not verify the subscription. Please try again or contact support.",
      code: "MISSING_TRANSACTION_ID",
    });
    return;
  }

  const expiresAt = validation.expiresAt || null;
  const result = await storage.claimTransactionAndUpgrade(
    {
      userId,
      transactionId: validation.originalTransactionId,
      receipt: compactReceipt(receipt),
      platform,
      productId: validation.productId ?? "unknown",
      status: "completed",
    },
    "premium",
    expiresAt,
  );

  if (result.status === "conflict") {
    log.warn(
      { userId, existingUserId: result.existingUserId },
      "subscription claim conflicts with an existing account binding",
    );
    sendError(
      res,
      409,
      "This subscription is already linked to another account.",
      "SUBSCRIPTION_ALREADY_LINKED",
    );
    return;
  }

  // created | renewed → entitlement granted/refreshed. Evict the cached tier so
  // it takes effect immediately instead of after the 60s TTL.
  invalidateTierCache(userId);
  res.json({
    success: true,
    tier: "premium",
    expiresAt: expiresAt?.toISOString() || null,
  });
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

        // The client-supplied `transactionId` is intentionally NOT used as the
        // stored key — entitlement is keyed on the validated receipt's
        // originalTransactionId inside applyValidatedReceipt. Binding to the
        // client value would let a replayed receipt with a fresh id grant
        // premium to a second account.
        const { receipt, platform, productId } = parsed.data;

        const validation = await validateReceipt(receipt, platform, productId);
        if (!validation.valid) {
          return res.json({
            success: false,
            error: "Receipt validation failed",
            code: validation.errorCode || "UNKNOWN",
          });
        }

        await applyValidatedReceipt(
          res,
          req.userId,
          receipt,
          platform,
          validation,
        );
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

        await applyValidatedReceipt(
          res,
          req.userId,
          receipt,
          platform,
          validation,
        );
      } catch (error) {
        handleRouteError(res, error, "restore purchases");
      }
    },
  );
}
