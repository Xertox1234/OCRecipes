import type { Express, Request, Response } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { requireAuth } from "../middleware/auth";
import { sendError } from "../lib/api-errors";
import { ErrorCode } from "@shared/constants/error-codes";
import { labelSessionStore } from "./photos";
import {
  compareWithVerifications,
  computeConsensus,
  extractVerificationNutrition,
  CONSENSUS_THRESHOLD,
  type VerificationNutrition,
} from "../services/verification-comparison";
import {
  verificationLevelSchema,
  consensusNutritionSchema,
} from "@shared/types/verification";
import { createRateLimiter } from "./_helpers";

const verificationRateLimit = createRateLimiter({
  windowMs: 60 * 1000,
  max: 10,
  message: "Too many verification requests, please try again later",
});

const submitSchema = z.object({
  barcode: z.string().min(1),
  sessionId: z.string().min(1),
});

export function register(app: Express): void {
  /**
   * Submit a barcode verification from a label scan session.
   * Does NOT count toward daily scan limit.
   */
  app.post(
    "/api/verification/submit",
    requireAuth,
    verificationRateLimit,
    async (req: Request, res: Response) => {
      try {
        const validated = submitSchema.parse(req.body);
        const { barcode, sessionId } = validated;

        // Get label data from existing session
        const session = labelSessionStore.get(sessionId);
        if (!session) {
          return sendError(
            res,
            404,
            "Label session not found or expired",
            ErrorCode.NOT_FOUND,
          );
        }

        if (session.userId !== req.userId!) {
          return sendError(res, 403, "Not authorized", ErrorCode.UNAUTHORIZED);
        }

        // Gate on OCR confidence
        if (session.labelData.confidence < 0.5) {
          return sendError(
            res,
            400,
            "Label scan confidence too low for verification. Please try again with better lighting.",
            ErrorCode.VALIDATION_ERROR,
          );
        }

        // Check if user already verified this barcode
        const alreadyVerified = await storage.hasUserVerified(
          barcode,
          req.userId!,
        );
        if (alreadyVerified) {
          return sendError(
            res,
            409,
            "You have already verified this product",
            ErrorCode.CONFLICT,
          );
        }

        // Extract core nutrition from label data
        const extracted = extractVerificationNutrition(session.labelData);

        // Get existing verifications for comparison
        const existingHistory = await storage.getVerificationHistory(barcode);
        const existingNutrition: VerificationNutrition[] = existingHistory
          .filter((h) => h.isMatch !== false) // Only compare against matching entries
          .map((h) => {
            const nutrition = h.extractedNutrition as Record<string, unknown>;
            return {
              calories:
                typeof nutrition.calories === "number"
                  ? nutrition.calories
                  : null,
              protein:
                typeof nutrition.protein === "number"
                  ? nutrition.protein
                  : null,
              totalCarbs:
                typeof nutrition.totalCarbs === "number"
                  ? nutrition.totalCarbs
                  : null,
              totalFat:
                typeof nutrition.totalFat === "number"
                  ? nutrition.totalFat
                  : null,
            };
          });

        // Compare against existing verifications
        const comparison = compareWithVerifications(
          extracted,
          existingNutrition,
        );

        // Determine new verification level
        const matchingCount = comparison.isMatch
          ? existingNutrition.length + 1
          : existingNutrition.length;

        let newLevel: string;
        if (matchingCount >= CONSENSUS_THRESHOLD) {
          newLevel = "verified";
        } else if (matchingCount >= 1) {
          newLevel = "single_verified";
        } else {
          newLevel = "unverified";
        }

        // Compute consensus from all matching verifications
        let consensusData = null;
        if (comparison.isMatch && matchingCount >= CONSENSUS_THRESHOLD) {
          const allMatching = [...existingNutrition, extracted];
          consensusData = computeConsensus(allMatching);
        }

        // Record verification (transactional)
        await storage.submitVerification(
          barcode,
          req.userId!,
          extracted,
          session.labelData.confidence,
          comparison.isMatch,
          newLevel,
          matchingCount,
          consensusData,
        );

        res.json({
          isMatch: comparison.isMatch,
          verificationLevel: newLevel,
          verificationCount: matchingCount,
        });
      } catch (error) {
        if (error instanceof z.ZodError) {
          return sendError(
            res,
            400,
            "Invalid request body",
            ErrorCode.VALIDATION_ERROR,
          );
        }
        console.error("Verification submit error:", error);
        sendError(
          res,
          500,
          "Failed to submit verification",
          ErrorCode.INTERNAL_ERROR,
        );
      }
    },
  );

  /**
   * Get the authenticated user's verification count.
   * Registered BEFORE /:barcode to avoid "user-count" matching as a barcode param.
   */
  app.get(
    "/api/verification/user-count",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const count = await storage.getUserVerificationCount(req.userId!);
        res.json({ count });
      } catch (error) {
        console.error("User verification count error:", error);
        sendError(
          res,
          500,
          "Failed to get verification count",
          ErrorCode.INTERNAL_ERROR,
        );
      }
    },
  );

  /**
   * Get verification status for a barcode.
   */
  app.get(
    "/api/verification/:barcode",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const barcode =
          typeof req.params.barcode === "string"
            ? req.params.barcode
            : undefined;
        if (!barcode) {
          return sendError(
            res,
            400,
            "Barcode is required",
            ErrorCode.VALIDATION_ERROR,
          );
        }

        const verification = await storage.getVerification(barcode);

        if (!verification) {
          return res.json({
            verificationLevel: "unverified",
            verificationCount: 0,
            consensusNutritionData: null,
          });
        }

        // Safe parse JSONB consensus data
        const consensusParsed = verification.consensusNutritionData
          ? consensusNutritionSchema.safeParse(
              verification.consensusNutritionData,
            )
          : null;

        res.json({
          verificationLevel: verification.verificationLevel,
          verificationCount: verification.verificationCount,
          consensusNutritionData: consensusParsed?.success
            ? consensusParsed.data
            : null,
        });
      } catch (error) {
        console.error("Verification status error:", error);
        sendError(
          res,
          500,
          "Failed to get verification status",
          ErrorCode.INTERNAL_ERROR,
        );
      }
    },
  );
}
