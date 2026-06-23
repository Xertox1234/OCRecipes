import type { Express, Response } from "express";
import crypto from "crypto";
import { storage, MAX_IMAGE_SIZE_BYTES } from "../storage";
import { z } from "zod";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth";
import { sendError } from "../lib/api-errors";
import { ErrorCode } from "@shared/constants/error-codes";
import {
  photoIntentSchema,
  INTENT_CONFIG,
  type PhotoIntent,
  preparationMethodSchema,
} from "@shared/constants/preparation";
import {
  analyzePhoto,
  analyzeLabelPhoto,
  analyzeRecipePhoto,
  classifyAndAnalyze,
  refineAnalysis,
  needsFollowUp,
  getFollowUpQuestions,
} from "../services/photo-analysis";
import type { PhotoIntentOrAuto } from "@shared/constants/classification";
import {
  batchNutritionLookup,
  countNonNullNutritionFields,
  mapLabelToNutritionData,
  writeNutritionCache,
} from "../services/nutrition-lookup";
import {
  handleRouteError,
  checkPremiumFeature,
  checkAiConfigured,
  getPremiumFeatures,
  parseStringParam,
  requireValidImage,
} from "./_helpers";
import { photoRateLimit, crudRateLimit } from "./_rate-limiters";
import { upload, createImageUpload } from "./_upload";

// Higher file size limit for label photos (5MB for text readability)
const labelUpload = createImageUpload(5 * 1024 * 1024);

// Zod schema for follow-up input validation
const followUpSchema = z.object({
  question: z.string().min(1).max(500),
  answer: z.string().min(1).max(1000),
});

// Zod schema for confirm request
const confirmPhotoSchema = z.object({
  sessionId: z.string(),
  foods: z.array(
    z.object({
      name: z.string(),
      quantity: z.string(),
      calories: z.number(),
      protein: z.number(),
      carbs: z.number(),
      fat: z.number(),
    }),
  ),
  mealType: z.string().optional(),
  preparationMethods: z.array(preparationMethodSchema).optional(),
  analysisIntent: photoIntentSchema.optional(),
});

/**
 * Attach nutrition data to a set of analyzed foods, keyed by "<quantity> <name>".
 * When `needsNutrition` is false, every food gets `nutrition: null` with no
 * lookup; otherwise each food is matched to its `batchNutritionLookup` result.
 * Generic over the food shape so callers keep their original field types.
 */
async function attachNutrition<F extends { name: string; quantity: string }>(
  foods: F[],
  needsNutrition: boolean,
) {
  const foodNames = foods.map((f) => `${f.quantity} ${f.name}`);
  const nutritionMap = needsNutrition
    ? await batchNutritionLookup(foodNames)
    : null;
  return foods.map((food, index) => ({
    ...food,
    nutrition: nutritionMap?.get(foodNames[index]) || null,
  }));
}

export function register(app: Express): void {
  // Photo Analysis Endpoints

  app.post(
    "/api/photos/analyze",
    requireAuth,
    photoRateLimit,
    upload.single("photo"),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        if (!checkAiConfigured(res)) return;

        // Premium gate
        const features = await checkPremiumFeature(
          req,
          res,
          "photoAnalysis",
          "Photo analysis",
        );
        if (!features) return;

        // Check scan limit
        const scanCount = await storage.getDailyScanCount(
          req.userId,
          new Date(),
        );

        if (scanCount >= features.maxDailyScans) {
          return sendError(
            res,
            429,
            "Daily scan limit reached",
            ErrorCode.LIMIT_REACHED,
          );
        }

        const imageBase64 = requireValidImage(req, res);
        if (!imageBase64) return;

        // Parse intent from multipart form parameters (default: "log")
        // Supports "auto" for smart scan classification
        // "menu" is intentionally NOT accepted here — restaurant menus are
        // parsed by the dedicated /api/menu/scan pipeline, not photo logging.
        // A stray intent=menu falls back to "log" via .catch (not a 500).
        const intentSchema = z
          .enum(["auto", "log", "calories", "identify", "recipe", "label"])
          .catch("log");
        const intentRaw = intentSchema.parse(
          req.body?.intent ?? "log",
        ) as PhotoIntentOrAuto;

        // ── Auto-classification flow ──────────────────────────────
        if (intentRaw === "auto") {
          // Validate session bounds BEFORE calling paid APIs to avoid wasted credits
          // requireValidImage guaranteed req.file is present above.
          if (req.file!.buffer.length > MAX_IMAGE_SIZE_BYTES) {
            return sendError(
              res,
              413,
              "Image too large for analysis session",
              ErrorCode.IMAGE_TOO_LARGE,
            );
          }

          const earlyCheck = storage.canCreateAnalysisSession(req.userId);
          if (!earlyCheck.allowed) {
            return sendError(res, 429, earlyCheck.reason, earlyCheck.code);
          }

          const classified = await classifyAndAnalyze(imageBase64);

          // If full analysis was performed (high confidence + mapped intent),
          // look up nutrition and create a session
          if (classified.analysisResult && classified.resolvedIntent) {
            const intent = classified.resolvedIntent;
            const intentConfig = INTENT_CONFIG[intent];
            const analysisResult = classified.analysisResult;

            const foodsWithNutrition = await attachNutrition(
              analysisResult.foods,
              intentConfig.needsNutrition,
            );

            let sessionId: string;
            if (intentConfig.needsSession) {
              // Atomic check+create eliminates the TOCTOU window (L12 fix).
              const sessionResult = storage.createAnalysisSessionIfAllowed(
                req.userId,
                analysisResult,
              );
              if (!sessionResult.ok) {
                return sendError(
                  res,
                  429,
                  sessionResult.reason,
                  sessionResult.code,
                );
              }
              sessionId = sessionResult.id;
            } else {
              sessionId = crypto.randomUUID();
            }

            return res.json({
              sessionId,
              intent,
              contentType: classified.contentType,
              confidence: classified.confidence,
              resolvedIntent: classified.resolvedIntent,
              barcode: classified.barcode,
              foods: foodsWithNutrition,
              overallConfidence: analysisResult.overallConfidence,
              needsFollowUp: needsFollowUp(analysisResult),
              followUpQuestions: getFollowUpQuestions(analysisResult),
            });
          }

          // Low confidence or no mapped intent — return classification only
          return res.json({
            sessionId: null,
            intent: "auto",
            contentType: classified.contentType,
            confidence: classified.confidence,
            resolvedIntent: classified.resolvedIntent,
            barcode: classified.barcode,
            foods: [],
            overallConfidence: classified.confidence,
            needsFollowUp: false,
            followUpQuestions: [],
          });
        }

        // ── Standard intent flow (unchanged) ──────────────────────
        const intentParsed = photoIntentSchema.safeParse(intentRaw);
        const intent: PhotoIntent = intentParsed.success
          ? intentParsed.data
          : "log";
        const intentConfig = INTENT_CONFIG[intent];

        // Validate session bounds BEFORE calling paid APIs to avoid wasted credits
        // requireValidImage guaranteed req.file is present above.
        if (intentConfig.needsSession) {
          if (req.file!.buffer.length > MAX_IMAGE_SIZE_BYTES) {
            return sendError(
              res,
              413,
              "Image too large for analysis session",
              ErrorCode.IMAGE_TOO_LARGE,
            );
          }

          const earlyCheck = storage.canCreateAnalysisSession(req.userId);
          if (!earlyCheck.allowed) {
            return sendError(res, 429, earlyCheck.reason, earlyCheck.code);
          }
        }

        // Analyze photo with Vision API (intent-aware prompt)
        const analysisResult = await analyzePhoto(imageBase64, intent);

        // Conditionally look up nutrition data
        const foodsWithNutrition = await attachNutrition(
          analysisResult.foods,
          intentConfig.needsNutrition,
        );

        // Generate session ID — atomic check+create eliminates TOCTOU (L12 fix).
        let sessionId: string;
        if (intentConfig.needsSession) {
          const sessionResult = storage.createAnalysisSessionIfAllowed(
            req.userId,
            analysisResult,
          );
          if (!sessionResult.ok) {
            return sendError(
              res,
              429,
              sessionResult.reason,
              sessionResult.code,
            );
          }
          sessionId = sessionResult.id;
        } else {
          sessionId = crypto.randomUUID();
        }

        const response = {
          sessionId,
          intent,
          foods: foodsWithNutrition,
          overallConfidence: analysisResult.overallConfidence,
          needsFollowUp: needsFollowUp(analysisResult),
          followUpQuestions: getFollowUpQuestions(analysisResult),
        };

        res.json(response);
      } catch (error) {
        handleRouteError(res, error, "analyze photo");
      }
    },
  );

  app.post(
    "/api/photos/analyze/:sessionId/followup",
    requireAuth,
    photoRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const sessionId = parseStringParam(req.params.sessionId);
        if (!sessionId) {
          return sendError(
            res,
            400,
            "Session ID is required",
            ErrorCode.VALIDATION_ERROR,
          );
        }

        const parsed = followUpSchema.safeParse(req.body);
        if (!parsed.success) {
          return sendError(
            res,
            400,
            "Invalid input",
            ErrorCode.VALIDATION_ERROR,
          );
        }
        const { question, answer } = parsed.data;

        const session = storage.getAnalysisSession(sessionId);
        // Treat a cross-user session as not found to avoid disclosing existence
        if (!session || session.userId !== req.userId) {
          return sendError(
            res,
            404,
            "Session not found or expired",
            ErrorCode.NOT_FOUND,
          );
        }

        // Refine analysis based on follow-up
        const refinedResult = await refineAnalysis(
          session.result,
          question,
          answer,
        );

        // Update session
        storage.updateAnalysisSession(sessionId, refinedResult);

        // Re-lookup nutrition with refined data
        const foodsWithNutrition = await attachNutrition(
          refinedResult.foods,
          true,
        );

        res.json({
          sessionId,
          foods: foodsWithNutrition,
          overallConfidence: refinedResult.overallConfidence,
          needsFollowUp: needsFollowUp(refinedResult),
          followUpQuestions: getFollowUpQuestions(refinedResult),
        });
      } catch (error) {
        handleRouteError(res, error, "process follow-up");
      }
    },
  );

  app.post(
    "/api/photos/confirm",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const validated = confirmPhotoSchema.parse(req.body);

        // Calculate totals
        const totals = validated.foods.reduce(
          (acc, food) => ({
            calories: acc.calories + food.calories,
            protein: acc.protein + food.protein,
            carbs: acc.carbs + food.carbs,
            fat: acc.fat + food.fat,
          }),
          { calories: 0, protein: 0, carbs: 0, fat: 0 },
        );

        // Get confidence from session if available. A cross-user session is
        // treated as if it did not exist — its data is ignored rather than
        // surfaced via a distinguishable error, hiding session existence.
        const fetchedSession = storage.getAnalysisSession(validated.sessionId);
        const ownedSession =
          fetchedSession && fetchedSession.userId === req.userId
            ? fetchedSession
            : undefined;

        const confidence = ownedSession?.result?.overallConfidence;

        // Create scanned item with photo source
        const scannedItem = await storage.createScannedItemWithLog(
          {
            userId: req.userId,
            productName: validated.foods.map((f) => f.name).join(", "),
            calories: totals.calories.toString(),
            protein: totals.protein.toString(),
            carbs: totals.carbs.toString(),
            fat: totals.fat.toString(),
            sourceType: "photo",
            aiConfidence: confidence?.toString(),
            preparationMethods: validated.preparationMethods || null,
            analysisIntent: validated.analysisIntent || null,
          },
          { mealType: validated.mealType || null },
        );

        // Clean up session and its timeout to prevent memory leaks
        storage.clearAnalysisSession(validated.sessionId);

        res.status(201).json(scannedItem);
      } catch (error) {
        handleRouteError(res, error, "save meal");
      }
    },
  );

  // ── Recipe Photo Analysis ────────────────────────────────────────────

  app.post(
    "/api/photos/analyze-recipe",
    requireAuth,
    photoRateLimit,
    labelUpload.single("photo"),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const features = await checkPremiumFeature(
          req,
          res,
          "recipePhotoImport",
          "Recipe photo import",
        );
        if (!features) return;

        const imageBase64 = requireValidImage(req, res);
        if (!imageBase64) return;

        const result = await analyzeRecipePhoto(imageBase64);

        res.json(result);
      } catch (error) {
        handleRouteError(res, error, "analyze recipe photo");
      }
    },
  );

  // ── Label Analysis Endpoints ──────────────────────────────────────────

  // Zod schema for confirm-label request
  const confirmLabelSchema = z.object({
    sessionId: z.string(),
    servingsConsumed: z.number().min(0.1).max(100).default(1),
    mealType: z.string().optional(),
  });

  app.post(
    "/api/photos/analyze-label",
    requireAuth,
    photoRateLimit,
    labelUpload.single("photo"),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        // Check scan limit (label scans share daily scan limit)
        const features = await getPremiumFeatures(req);
        const scanCount = await storage.getDailyScanCount(
          req.userId,
          new Date(),
        );

        if (scanCount >= features.maxDailyScans) {
          return sendError(
            res,
            429,
            "Daily scan limit reached",
            ErrorCode.LIMIT_REACHED,
          );
        }

        const imageBase64 = requireValidImage(req, res);
        if (!imageBase64) return;

        const barcodeRaw = req.body?.barcode as string | undefined;
        const barcode = barcodeRaw
          ? z
              .string()
              .regex(/^\d{8,14}$/)
              .safeParse(barcodeRaw).success
            ? barcodeRaw
            : undefined
          : undefined;

        // Early guard — reject before calling paid APIs to avoid wasted credits.
        const earlyLabelCheck = storage.canCreateLabelSession(req.userId);
        if (!earlyLabelCheck.allowed) {
          return sendError(
            res,
            429,
            earlyLabelCheck.reason,
            earlyLabelCheck.code,
          );
        }

        const labelData = await analyzeLabelPhoto(imageBase64);

        // Atomic check+create eliminates the TOCTOU window (L12 fix).
        const labelSessionResult = storage.createLabelSessionIfAllowed(
          req.userId,
          labelData,
          barcode,
        );
        if (!labelSessionResult.ok) {
          return sendError(
            res,
            429,
            labelSessionResult.reason,
            labelSessionResult.code,
          );
        }
        const sessionId = labelSessionResult.id;

        res.json({
          sessionId,
          intent: "label" as const,
          labelData,
          barcode,
        });
      } catch (error) {
        handleRouteError(res, error, "analyze label");
      }
    },
  );

  app.post(
    "/api/photos/confirm-label",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const validated = confirmLabelSchema.parse(req.body);

        const session = storage.getLabelSession(validated.sessionId);
        // Treat a cross-user session as not found to avoid disclosing existence
        if (!session || session.userId !== req.userId) {
          return sendError(
            res,
            404,
            "Session not found or expired",
            ErrorCode.NOT_FOUND,
          );
        }

        const { labelData, barcode } = session;
        const servings = validated.servingsConsumed;

        // Clamp negative AI values to 0 (defense-in-depth for DB CHECK constraints)
        const clamp = (v: number | null) => Math.max(v ?? 0, 0);

        // Scale values by servings consumed
        const scaledCalories = clamp(labelData.calories) * servings;
        const scaledProtein = clamp(labelData.protein) * servings;
        const scaledCarbs = clamp(labelData.totalCarbs) * servings;
        const scaledFat = clamp(labelData.totalFat) * servings;
        const scaledFiber = clamp(labelData.dietaryFiber) * servings;
        const scaledSugar = clamp(labelData.totalSugars) * servings;
        const scaledSodium = clamp(labelData.sodium) * servings;

        const productName = labelData.productName || "Nutrition label scan";

        const scannedItem = await storage.createScannedItemWithLog(
          {
            userId: req.userId,
            barcode: barcode || null,
            productName,
            servingSize: labelData.servingSize || null,
            calories: scaledCalories.toString(),
            protein: scaledProtein.toString(),
            carbs: scaledCarbs.toString(),
            fat: scaledFat.toString(),
            fiber: scaledFiber.toString(),
            sugar: scaledSugar.toString(),
            sodium: scaledSodium.toString(),
            sourceType: "label",
            aiConfidence: labelData.confidence.toString(),
          },
          { mealType: validated.mealType || null },
        );

        // Silent cache seeding: if barcode was provided and NO cache entry
        // exists yet, seed the cache with label data. Never overwrite existing
        // entries to prevent cache poisoning (any user could provide an
        // arbitrary barcode string with their label confirmation).
        if (barcode) {
          try {
            const labelNutrition = mapLabelToNutritionData(labelData);
            const labelFieldCount = countNonNullNutritionFields(labelNutrition);
            if (labelFieldCount >= 4) {
              await writeNutritionCache(barcode, labelNutrition, {
                allowOverwrite: false,
              });
            }
          } catch {
            // Cache seeding is best-effort
          }
        }

        // Clean up session (also decrements per-user count)
        storage.clearLabelSession(validated.sessionId);

        res.status(201).json(scannedItem);
      } catch (error) {
        handleRouteError(res, error, "save label data");
      }
    },
  );
}
