import type { Express, Response } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth";
import { sendError } from "../lib/api-errors";
import { ErrorCode } from "@shared/constants/error-codes";
import { logger } from "../lib/logger";
import { detectImageMimeType } from "../lib/image-mime";
import {
  compareWithVerifications,
  computeConsensus,
  extractVerificationNutrition,
  CONSENSUS_THRESHOLD,
  type VerificationNutrition,
} from "../services/verification-comparison";
import { detectReformulation } from "../services/reformulation-detection";
import { analyzeFrontLabel } from "../services/front-label-analysis";
import { consensusNutritionSchema } from "@shared/types/verification";
import { frontLabelDataSchema } from "@shared/types/front-label";
import {
  checkAiConfigured,
  handleRouteError,
  parseQueryInt,
  parseQueryString,
  parseStringParam,
} from "./_helpers";
import { crudRateLimit, createRateLimiter } from "./_rate-limiters";
import { createImageUpload } from "./_upload";
import { isAdmin } from "./_admin";

const verificationRateLimit = createRateLimiter({
  windowMs: 60 * 1000,
  max: 10,
  message: "Too many verification requests, please try again later",
});

const frontLabelRateLimit = createRateLimiter({
  windowMs: 60 * 1000,
  max: 10,
  message: "Too many front-label scan requests, please try again later",
});

const barcodeField = z.string().regex(/^\d{8,14}$/, "Invalid barcode format");

const submitSchema = z.object({
  barcode: barcodeField,
  sessionId: z.string().min(1),
});

const frontLabelConfirmSchema = z.object({
  barcode: barcodeField,
  sessionId: z.string().min(1),
});

// Multer config for front-label photo uploads (5MB limit)
const frontLabelUpload = createImageUpload(5 * 1024 * 1024);

const frontLabelStore = storage.frontLabelSessionStore;

// Exported for testing (grouped per docs/patterns/security.md Test Internals Export Pattern)
export const _testInternals = {
  frontLabelSessionStore: frontLabelStore._internals.store,
  userFrontLabelSessionCount: frontLabelStore._internals.userCount,
  clearFrontLabelSession: frontLabelStore.clear,
};

export function register(app: Express): void {
  /**
   * Submit a barcode verification from a label scan session.
   * Does NOT count toward daily scan limit.
   */
  app.post(
    "/api/verification/submit",
    requireAuth,
    verificationRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const validated = submitSchema.parse(req.body);
        const { barcode, sessionId } = validated;

        // Get label data from existing session
        const session = storage.getLabelSession(sessionId);
        if (!session) {
          return sendError(
            res,
            404,
            "Label session not found or expired",
            ErrorCode.NOT_FOUND,
          );
        }

        if (session.userId !== req.userId) {
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

        // Check if user already verified this barcode (parallel with history fetch)
        const [alreadyVerified, existingHistory] = await Promise.all([
          storage.hasUserVerified(barcode, req.userId),
          storage.getVerificationHistory(barcode),
        ]);
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

        // ── Snapshot pre-submit state for reformulation detection ─────
        // Must read BEFORE submitVerification() mutates the row, otherwise
        // we'd compare against post-mutation state (race condition).
        let preSubmitVerification: Awaited<
          ReturnType<typeof storage.getVerification>
        > | null = null;
        if (!comparison.isMatch) {
          preSubmitVerification = await storage.getVerification(barcode);
        }

        // Record verification (transactional)
        await storage.submitVerification(
          barcode,
          req.userId,
          extracted,
          session.labelData.confidence,
          comparison.isMatch,
          newLevel,
          matchingCount,
          consensusData,
        );

        // ── Reformulation detection ──────────────────────────────────
        // When a scan doesn't match on a previously-verified product,
        // check if enough divergent scans have accumulated to flag it.
        if (
          !comparison.isMatch &&
          preSubmitVerification &&
          preSubmitVerification.verificationLevel === "verified" &&
          preSubmitVerification.consensusNutritionData
        ) {
          const consensusParsed = consensusNutritionSchema.safeParse(
            preSubmitVerification.consensusNutritionData,
          );
          const existingFlag = await storage.getReformulationFlag(barcode);

          if (consensusParsed.success && !existingFlag) {
            // Build full history from existing + new entry (avoids duplicate DB query)
            const mapHistoryEntry = (h: {
              extractedNutrition: unknown;
              userId: string;
              isMatch: boolean | null;
            }) => {
              const n = h.extractedNutrition as Record<string, unknown>;
              return {
                extractedNutrition: {
                  calories: typeof n.calories === "number" ? n.calories : null,
                  protein: typeof n.protein === "number" ? n.protein : null,
                  totalCarbs:
                    typeof n.totalCarbs === "number" ? n.totalCarbs : null,
                  totalFat: typeof n.totalFat === "number" ? n.totalFat : null,
                },
                userId: h.userId,
                isMatch: h.isMatch ?? true,
              };
            };
            const historyForDetection = [
              mapHistoryEntry({
                extractedNutrition: extracted,
                userId: req.userId,
                isMatch: comparison.isMatch,
              }),
              ...existingHistory.map(mapHistoryEntry),
            ];

            const detection = detectReformulation(
              consensusParsed.data,
              historyForDetection,
            );

            if (detection.shouldFlag) {
              logger.info(
                {
                  barcode,
                  divergentCount: detection.divergentCount,
                  distinctUsers: detection.distinctUsers,
                },
                "product flagged for reformulation",
              );
              await storage.flagReformulation(
                barcode,
                detection.divergentCount,
                consensusParsed.data,
                preSubmitVerification.verificationLevel,
                preSubmitVerification.verificationCount,
              );
            }
          }
        }

        // Check if user can scan front label (hasn't already done it for this barcode)
        const canScanFrontLabel = !(await storage.hasUserFrontLabelScanned(
          barcode,
          req.userId,
        ));

        res.json({
          isMatch: comparison.isMatch,
          verificationLevel: newLevel,
          verificationCount: matchingCount,
          canScanFrontLabel,
        });
      } catch (error) {
        handleRouteError(res, error, "verification submit");
      }
    },
  );

  /**
   * Upload a front-of-package photo for extraction.
   * Returns sessionId + extracted data for confirmation.
   */
  app.post(
    "/api/verification/front-label",
    requireAuth,
    frontLabelRateLimit,
    frontLabelUpload.single("photo"),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        if (!req.file) {
          return sendError(
            res,
            400,
            "No photo provided",
            ErrorCode.VALIDATION_ERROR,
          );
        }

        if (!detectImageMimeType(req.file.buffer)) {
          return sendError(
            res,
            400,
            "Invalid image content. Only JPEG, PNG, and WebP allowed.",
            ErrorCode.VALIDATION_ERROR,
          );
        }

        const barcodeRaw = req.body?.barcode as string;
        const barcodeResult = barcodeField.safeParse(barcodeRaw);
        if (!barcodeResult.success) {
          return sendError(
            res,
            400,
            "Invalid barcode format",
            ErrorCode.VALIDATION_ERROR,
          );
        }
        const barcode = barcodeResult.data;

        // Check session bounds
        const check = frontLabelStore.canCreate(req.userId);
        if (!check.allowed) {
          return sendError(res, 429, check.reason, check.code);
        }

        // User must have back-label verified this barcode first
        const hasVerified = await storage.hasUserVerified(barcode, req.userId);
        if (!hasVerified) {
          return sendError(
            res,
            400,
            "You must verify the nutrition label before scanning the front of the package",
            ErrorCode.VALIDATION_ERROR,
          );
        }

        if (!checkAiConfigured(res)) return;

        const imageBase64 = req.file.buffer.toString("base64");
        const data = await analyzeFrontLabel(imageBase64);

        // Store session for confirm step (factory handles timeout + user count)
        const sessionId = frontLabelStore.create({
          userId: req.userId,
          data,
          barcode,
          createdAt: Date.now(),
        });

        res.json({ sessionId, data });
      } catch (error) {
        handleRouteError(res, error, "front label analysis");
      }
    },
  );

  /**
   * Confirm front-label data and store on the barcode verification record.
   * Awards 0.5 gamification credit on first scan per barcode per user.
   */
  app.post(
    "/api/verification/front-label/confirm",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const validated = frontLabelConfirmSchema.parse(req.body);
        const { barcode, sessionId } = validated;

        // Get front-label session
        const session = frontLabelStore.get(sessionId);
        if (!session) {
          return sendError(
            res,
            404,
            "Front-label session not found or expired",
            ErrorCode.NOT_FOUND,
          );
        }

        if (session.userId !== req.userId) {
          return sendError(res, 403, "Not authorized", ErrorCode.UNAUTHORIZED);
        }

        if (session.barcode !== barcode) {
          return sendError(
            res,
            400,
            "Barcode does not match session",
            ErrorCode.VALIDATION_ERROR,
          );
        }

        // User must have back-label verified this barcode
        const hasVerified = await storage.hasUserVerified(barcode, req.userId);
        if (!hasVerified) {
          return sendError(
            res,
            400,
            "You must verify the nutrition label first",
            ErrorCode.VALIDATION_ERROR,
          );
        }

        // Build front-label data object
        const frontLabelData = {
          brand: session.data.brand,
          productName: session.data.productName,
          netWeight: session.data.netWeight,
          claims: session.data.claims,
          scannedByUserId: parseInt(req.userId, 10),
          scannedAt: new Date().toISOString(),
        };

        // Validate with Zod before storing
        const parsed = frontLabelDataSchema.safeParse(frontLabelData);
        if (!parsed.success) {
          logger.warn(
            { zodErrors: parsed.error.flatten() },
            "front label data validation failed",
          );
          return sendError(
            res,
            500,
            "Failed to validate front label data",
            ErrorCode.INTERNAL_ERROR,
          );
        }

        // Store front-label data and mark user's history (transactional)
        await storage.confirmFrontLabelData(barcode, req.userId, parsed.data);

        // Clean up session
        frontLabelStore.clear(sessionId);

        res.json({ success: true, frontLabelScanned: true });
      } catch (error) {
        handleRouteError(res, error, "front label confirm");
      }
    },
  );

  /**
   * Get reformulation-flagged products (admin only).
   * Registered BEFORE /:barcode to avoid route collision.
   */
  app.get(
    "/api/verification/reformulation-flags",
    requireAuth,
    verificationRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        if (!isAdmin(req.userId)) {
          return sendError(
            res,
            403,
            "Admin access required",
            ErrorCode.UNAUTHORIZED,
          );
        }

        const statusParam = parseQueryString(req.query.status);
        const status =
          statusParam === "flagged" || statusParam === "resolved"
            ? statusParam
            : undefined;
        const limit = parseQueryInt(req.query.limit, {
          default: 50,
          max: 100,
        });
        const offset = parseQueryInt(req.query.offset, { default: 0 });

        const [flags, totalCount] = await Promise.all([
          storage.getReformulationFlags(status, limit, offset),
          storage.getReformulationFlagCount(status),
        ]);

        res.json({ flags, total: totalCount, limit, offset });
      } catch (error) {
        handleRouteError(res, error, "get reformulation flags");
      }
    },
  );

  /**
   * Resolve a reformulation flag (admin only).
   */
  app.post(
    "/api/verification/reformulation-flags/:flagId/resolve",
    requireAuth,
    verificationRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        if (!isAdmin(req.userId)) {
          return sendError(
            res,
            403,
            "Admin access required",
            ErrorCode.UNAUTHORIZED,
          );
        }

        const flagId = parseInt(parseStringParam(req.params.flagId) ?? "", 10);
        if (isNaN(flagId)) {
          return sendError(
            res,
            400,
            "Invalid flag ID",
            ErrorCode.VALIDATION_ERROR,
          );
        }

        const resolved = await storage.resolveReformulationFlag(flagId);
        if (!resolved) {
          return sendError(
            res,
            404,
            "Reformulation flag not found",
            ErrorCode.NOT_FOUND,
          );
        }

        res.json({ success: true });
      } catch (error) {
        handleRouteError(res, error, "resolve reformulation flag");
      }
    },
  );

  /**
   * Get the authenticated user's verification stats (count, streak, badge tier).
   * Registered BEFORE /:barcode to avoid "user-count" matching as a barcode param.
   */
  app.get(
    "/api/verification/user-count",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const stats = await storage.getUserVerificationStats(req.userId);
        res.json(stats);
      } catch (error) {
        handleRouteError(res, error, "get verification stats");
      }
    },
  );

  /**
   * Get verification status for a barcode.
   */
  app.get(
    "/api/verification/:barcode",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const barcodeParam = req.params.barcode;
        const barcodeParamResult = barcodeField.safeParse(barcodeParam);
        if (!barcodeParamResult.success) {
          return sendError(
            res,
            400,
            "Invalid barcode format",
            ErrorCode.VALIDATION_ERROR,
          );
        }
        const barcode = barcodeParamResult.data;

        const verification = await storage.getVerification(barcode);

        if (!verification) {
          return res.json({
            verificationLevel: "unverified",
            verificationCount: 0,
            consensusNutritionData: null,
            hasFrontLabelData: false,
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
          hasFrontLabelData: verification.frontLabelData != null,
        });
      } catch (error) {
        handleRouteError(res, error, "get verification status");
      }
    },
  );
}
