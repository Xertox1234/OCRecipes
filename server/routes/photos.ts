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
  cacheNutritionIfAbsent,
} from "../services/nutrition-lookup";
import {
  handleRouteError,
  checkPremiumFeature,
  checkAiConfigured,
  getPremiumFeatures,
  parseStringParam,
} from "./_helpers";
import { photoRateLimit, crudRateLimit } from "./_rate-limiters";
import { upload, createImageUpload } from "./_upload";
import { detectImageMimeType } from "../lib/image-mime";
import { logger, toError } from "../lib/logger";

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

        if (!req.file) {
          return sendError(
            res,
            400,
            "No photo provided",
            ErrorCode.VALIDATION_ERROR,
          );
        }

        // Validate image content via magic bytes (don't trust client mimetype)
        if (!detectImageMimeType(req.file.buffer)) {
          return sendError(
            res,
            400,
            "Invalid image content. Only JPEG, PNG, and WebP allowed.",
            ErrorCode.VALIDATION_ERROR,
          );
        }

        // Parse intent from multipart form parameters (default: "log")
        // Supports "auto" for smart scan classification
        const intentSchema = z
          .enum([
            "auto",
            "log",
            "calories",
            "identify",
            "recipe",
            "menu",
            "label",
          ])
          .catch("log");
        const intentRaw = intentSchema.parse(
          req.body?.intent ?? "log",
        ) as PhotoIntentOrAuto;

        // Convert buffer to base64
        const imageBase64 = req.file.buffer.toString("base64");

        // ── Auto-classification flow ──────────────────────────────
        if (intentRaw === "auto") {
          // Validate session bounds BEFORE calling paid APIs to avoid wasted credits
          if (req.file.buffer.length > MAX_IMAGE_SIZE_BYTES) {
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

            let foodsWithNutrition;
            if (intentConfig.needsNutrition) {
              const foodNames = analysisResult.foods.map(
                (f) => `${f.quantity} ${f.name}`,
              );
              const nutritionMap = await batchNutritionLookup(foodNames);
              foodsWithNutrition = analysisResult.foods.map((food, index) => {
                const query = foodNames[index];
                const nutrition = nutritionMap.get(query);
                return { ...food, nutrition: nutrition || null };
              });
            } else {
              foodsWithNutrition = analysisResult.foods.map((food) => ({
                ...food,
                nutrition: null,
              }));
            }

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
        if (intentConfig.needsSession) {
          if (req.file.buffer.length > MAX_IMAGE_SIZE_BYTES) {
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
        let foodsWithNutrition;
        if (intentConfig.needsNutrition) {
          const foodNames = analysisResult.foods.map(
            (f) => `${f.quantity} ${f.name}`,
          );
          const nutritionMap = await batchNutritionLookup(foodNames);
          foodsWithNutrition = analysisResult.foods.map((food, index) => {
            const query = foodNames[index];
            const nutrition = nutritionMap.get(query);
            return { ...food, nutrition: nutrition || null };
          });
        } else {
          foodsWithNutrition = analysisResult.foods.map((food) => ({
            ...food,
            nutrition: null,
          }));
        }

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
        logger.error({ err: toError(error) }, "photo analysis error");
        sendError(
          res,
          500,
          "Failed to analyze photo",
          ErrorCode.INTERNAL_ERROR,
        );
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
        if (!session) {
          return sendError(
            res,
            404,
            "Session not found or expired",
            ErrorCode.NOT_FOUND,
          );
        }

        // Verify session ownership
        if (session.userId !== req.userId) {
          return sendError(res, 403, "Not authorized", ErrorCode.UNAUTHORIZED);
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
        const foodNames = refinedResult.foods.map(
          (f) => `${f.quantity} ${f.name}`,
        );
        const nutritionMap = await batchNutritionLookup(foodNames);

        const foodsWithNutrition = refinedResult.foods.map((food, index) => {
          const query = foodNames[index];
          const nutrition = nutritionMap.get(query);
          return {
            ...food,
            nutrition: nutrition || null,
          };
        });

        res.json({
          sessionId,
          foods: foodsWithNutrition,
          overallConfidence: refinedResult.overallConfidence,
          needsFollowUp: needsFollowUp(refinedResult),
          followUpQuestions: getFollowUpQuestions(refinedResult),
        });
      } catch (error) {
        logger.error({ err: toError(error) }, "follow-up error");
        sendError(
          res,
          500,
          "Failed to process follow-up",
          ErrorCode.INTERNAL_ERROR,
        );
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

        // Get confidence from session if available
        const session = storage.getAnalysisSession(validated.sessionId);

        // Verify session ownership if session exists
        if (session && session.userId !== req.userId) {
          return sendError(res, 403, "Not authorized", ErrorCode.UNAUTHORIZED);
        }

        const confidence = session?.result?.overallConfidence;

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

        const imageBase64 = req.file.buffer.toString("base64");
        const result = await analyzeRecipePhoto(imageBase64);

        res.json(result);
      } catch (error) {
        logger.error({ err: toError(error) }, "recipe photo analysis error");
        sendError(
          res,
          500,
          "Failed to analyze recipe photo",
          ErrorCode.INTERNAL_ERROR,
        );
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

        const imageBase64 = req.file.buffer.toString("base64");
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
        logger.error({ err: toError(error) }, "label analysis error");
        sendError(
          res,
          500,
          "Failed to analyze label",
          ErrorCode.INTERNAL_ERROR,
        );
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
        if (!session) {
          return sendError(
            res,
            404,
            "Session not found or expired",
            ErrorCode.NOT_FOUND,
          );
        }

        if (session.userId !== req.userId) {
          return sendError(res, 403, "Not authorized", ErrorCode.UNAUTHORIZED);
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
              await cacheNutritionIfAbsent(barcode, labelNutrition);
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
