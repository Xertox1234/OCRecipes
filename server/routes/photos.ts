import type { Express, Response } from "express";
import crypto from "crypto";
import { MAX_IMAGE_SIZE_BYTES } from "../storage/sessions";
import { z, ZodError } from "zod";
import { storage } from "../storage";
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
  photoRateLimit,
  formatZodError,
  upload,
  createImageUpload,
  checkPremiumFeature,
  checkAiConfigured,
  getPremiumFeatures,
  parseStringParam,
} from "./_helpers";
import { detectImageMimeType } from "../lib/image-mime";

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
        const intentRaw = ((req.body?.intent as string) ||
          "log") as PhotoIntentOrAuto;

        // Convert buffer to base64
        const imageBase64 = req.file.buffer.toString("base64");

        // ── Auto-classification flow ──────────────────────────────
        if (intentRaw === "auto") {
          // Validate session bounds BEFORE calling paid APIs
          if (req.file.buffer.length > MAX_IMAGE_SIZE_BYTES) {
            return sendError(
              res,
              413,
              "Image too large for analysis session",
              "IMAGE_TOO_LARGE",
            );
          }

          const sessionCheck = storage.canCreateAnalysisSession(req.userId);
          if (!sessionCheck.allowed) {
            return sendError(res, 429, sessionCheck.reason, sessionCheck.code);
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

            const sessionId = intentConfig.needsSession
              ? storage.createAnalysisSession(req.userId, analysisResult)
              : crypto.randomUUID();

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
              "IMAGE_TOO_LARGE",
            );
          }

          const sessionCheck = storage.canCreateAnalysisSession(req.userId);
          if (!sessionCheck.allowed) {
            return sendError(res, 429, sessionCheck.reason, sessionCheck.code);
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

        // Generate session ID (needed for follow-ups and confirm)
        const sessionId = intentConfig.needsSession
          ? storage.createAnalysisSession(req.userId, analysisResult)
          : crypto.randomUUID();

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
        console.error("Photo analysis error:", error);
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
        console.error("Follow-up error:", error);
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
        if (error instanceof ZodError) {
          return sendError(
            res,
            400,
            formatZodError(error),
            ErrorCode.VALIDATION_ERROR,
          );
        }
        console.error("Confirm error:", error);
        sendError(res, 500, "Failed to save meal", ErrorCode.INTERNAL_ERROR);
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
        console.error("Recipe photo analysis error:", error);
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
        const barcode = (req.body?.barcode as string) || undefined;

        // Check label session bounds before calling paid APIs
        const labelCheck = storage.canCreateLabelSession(req.userId);
        if (!labelCheck.allowed) {
          return sendError(res, 429, labelCheck.reason, labelCheck.code);
        }

        const labelData = await analyzeLabelPhoto(imageBase64);

        // Store session for confirm step
        const sessionId = storage.createLabelSession(
          req.userId,
          labelData,
          barcode,
        );

        res.json({
          sessionId,
          intent: "label" as const,
          labelData,
          barcode,
        });
      } catch (error) {
        console.error("Label analysis error:", error);
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

        // Scale values by servings consumed
        const scaledCalories = (labelData.calories ?? 0) * servings;
        const scaledProtein = (labelData.protein ?? 0) * servings;
        const scaledCarbs = (labelData.totalCarbs ?? 0) * servings;
        const scaledFat = (labelData.totalFat ?? 0) * servings;
        const scaledFiber = (labelData.dietaryFiber ?? 0) * servings;
        const scaledSugar = (labelData.totalSugars ?? 0) * servings;
        const scaledSodium = (labelData.sodium ?? 0) * servings;

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
        if (error instanceof ZodError) {
          return sendError(
            res,
            400,
            formatZodError(error),
            ErrorCode.VALIDATION_ERROR,
          );
        }
        console.error("Label confirm error:", error);
        sendError(
          res,
          500,
          "Failed to save label data",
          ErrorCode.INTERNAL_ERROR,
        );
      }
    },
  );
}
