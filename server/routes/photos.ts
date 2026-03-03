import type { Express, Request, Response } from "express";
import crypto from "crypto";
import { z, ZodError } from "zod";
import { storage } from "../storage";
import { db } from "../db";
import { requireAuth } from "../middleware/auth";
import { sendError } from "../lib/api-errors";
import { ErrorCode } from "@shared/constants/error-codes";
import { scannedItems, dailyLogs } from "@shared/schema";
import {
  photoIntentSchema,
  INTENT_CONFIG,
  type PhotoIntent,
  preparationMethodSchema,
} from "@shared/constants/preparation";
import {
  analyzePhoto,
  refineAnalysis,
  needsFollowUp,
  getFollowUpQuestions,
  type AnalysisResult,
} from "../services/photo-analysis";
import { batchNutritionLookup } from "../services/nutrition-lookup";
import {
  photoRateLimit,
  formatZodError,
  upload,
  checkPremiumFeature,
  parseStringParam,
} from "./_helpers";

// In-memory store for analysis sessions
// TODO: Replace with Redis for horizontal scaling in production
interface AnalysisSession {
  userId: string;
  result: AnalysisResult;
  imageBase64?: string;
  /** Timestamp used for diagnostics and future LRU eviction when migrating to Redis */
  createdAt: number;
}
const analysisSessionStore = new Map<string, AnalysisSession>();

// Track session timeout references to prevent memory leaks
const sessionTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

// Per-user session count for enforcing per-user caps
const userSessionCount = new Map<string, number>();

// Session limits
const MAX_SESSIONS_PER_USER = 3;
const MAX_SESSIONS_GLOBAL = 1000;
const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB decoded

// Session timeout duration (30 minutes)
const SESSION_TIMEOUT = 30 * 60 * 1000;

/**
 * Decrement the per-user session count (and clean up entry when zero).
 */
function decrementUserCount(userId: string): void {
  const count = userSessionCount.get(userId) ?? 0;
  if (count <= 1) {
    userSessionCount.delete(userId);
  } else {
    userSessionCount.set(userId, count - 1);
  }
}

/**
 * Clear session and its associated timeout.
 * Call this whenever a session is deleted to prevent memory leaks.
 */
function clearSession(sessionId: string): void {
  const session = analysisSessionStore.get(sessionId);
  const existingTimeout = sessionTimeouts.get(sessionId);
  if (existingTimeout) {
    clearTimeout(existingTimeout);
    sessionTimeouts.delete(sessionId);
  }
  analysisSessionStore.delete(sessionId);
  if (session) {
    decrementUserCount(session.userId);
  }
}

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
 * Internal state exported for testing only.
 * Convention: prefix with underscore to signal non-public API.
 * See docs/PATTERNS.md "Test Internals Export Pattern".
 */
export const _testInternals = {
  analysisSessionStore,
  userSessionCount,
  MAX_SESSIONS_PER_USER,
  MAX_SESSIONS_GLOBAL,
  MAX_IMAGE_SIZE_BYTES,
  clearSession,
};

export function register(app: Express): void {
  // Photo Analysis Endpoints

  app.post(
    "/api/photos/analyze",
    requireAuth,
    photoRateLimit,
    upload.single("photo"),
    async (req: Request, res: Response) => {
      try {
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
          req.userId!,
          new Date(),
        );

        if (scanCount >= features.maxDailyScans) {
          return sendError(
            res,
            429,
            "Daily scan limit reached",
            "DAILY_LIMIT_REACHED",
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

        // Parse intent from multipart form parameters (default: "log")
        const intentRaw = (req.body?.intent as string) || "log";
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

          if (analysisSessionStore.size >= MAX_SESSIONS_GLOBAL) {
            return sendError(
              res,
              429,
              "Server is busy, please try again later",
              "SESSION_LIMIT_REACHED",
            );
          }

          const currentUserSessions = userSessionCount.get(req.userId!) ?? 0;
          if (currentUserSessions >= MAX_SESSIONS_PER_USER) {
            return sendError(
              res,
              429,
              "Too many active analysis sessions. Please confirm or wait for existing sessions to expire.",
              "USER_SESSION_LIMIT",
            );
          }
        }

        // Convert buffer to base64
        const imageBase64 = req.file.buffer.toString("base64");

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
        const sessionId = crypto.randomUUID();
        if (intentConfig.needsSession) {
          const currentUserSessions = userSessionCount.get(req.userId!) ?? 0;

          analysisSessionStore.set(sessionId, {
            userId: req.userId!,
            result: analysisResult,
            imageBase64,
            createdAt: Date.now(),
          });
          userSessionCount.set(req.userId!, currentUserSessions + 1);

          // Clean up old sessions after timeout, tracking the timeout reference
          const timeoutId = setTimeout(() => {
            clearSession(sessionId);
          }, SESSION_TIMEOUT);
          sessionTimeouts.set(sessionId, timeoutId);
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
    async (req: Request, res: Response) => {
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

        const session = analysisSessionStore.get(sessionId);
        if (!session) {
          return sendError(
            res,
            404,
            "Session not found or expired",
            ErrorCode.NOT_FOUND,
          );
        }

        // Verify session ownership
        if (session.userId !== req.userId!) {
          return sendError(res, 403, "Not authorized", ErrorCode.UNAUTHORIZED);
        }

        // Refine analysis based on follow-up
        const refinedResult = await refineAnalysis(
          session.result,
          question,
          answer,
        );

        // Update session
        session.result = refinedResult;
        analysisSessionStore.set(sessionId, session);

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
    async (req: Request, res: Response) => {
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
        const session = analysisSessionStore.get(validated.sessionId);

        // Verify session ownership if session exists
        if (session && session.userId !== req.userId!) {
          return sendError(res, 403, "Not authorized", ErrorCode.UNAUTHORIZED);
        }

        const confidence = session?.result?.overallConfidence;

        // Create scanned item with photo source
        const [scannedItem] = await db.transaction(async (tx) => {
          const [item] = await tx
            .insert(scannedItems)
            .values({
              userId: req.userId!,
              productName: validated.foods.map((f) => f.name).join(", "),
              calories: totals.calories.toString(),
              protein: totals.protein.toString(),
              carbs: totals.carbs.toString(),
              fat: totals.fat.toString(),
              sourceType: "photo",
              aiConfidence: confidence?.toString(),
              preparationMethods: validated.preparationMethods || null,
              analysisIntent: validated.analysisIntent || null,
            })
            .returning();

          await tx.insert(dailyLogs).values({
            userId: req.userId!,
            scannedItemId: item.id,
            servings: "1",
            mealType: validated.mealType || null,
          });

          return [item];
        });

        // Clean up session and its timeout to prevent memory leaks
        clearSession(validated.sessionId);

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
}
