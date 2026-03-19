import type { Express, Request, Response } from "express";
import crypto from "crypto";
import { requireAuth } from "../middleware/auth";
import { sendError } from "../lib/api-errors";
import { ErrorCode } from "@shared/constants/error-codes";
import { type FoodCategory } from "@shared/constants/preparation";
import {
  formatZodError,
  checkPremiumFeature,
  parseStringParam,
  createRateLimiter,
} from "./_helpers";
import {
  ingredientEditSchema,
  nutritionRequestSchema,
  logRequestSchema,
  substitutionRequestSchema,
  photoAnalysisResponseSchema,
  type CookingSessionIngredient,
  type CookSessionNutritionItem,
  type CookSessionNutritionSummary,
} from "@shared/types/cook-session";
import { openai, OPENAI_TIMEOUT_HEAVY_MS } from "../lib/openai";
import { SYSTEM_PROMPT_BOUNDARY } from "../lib/ai-safety";
import { batchNutritionLookup } from "../services/nutrition-lookup";
import {
  calculateCookedNutrition,
  preparationToCookingMethod,
} from "../services/cooking-adjustment";
import { generateRecipeContent } from "../services/recipe-generation";
import { getSubstitutions } from "../services/ingredient-substitution";
import {
  detectAllergens,
  parseUserAllergies,
  type AllergenMatch,
} from "@shared/constants/allergens";
import { scannedItems, dailyLogs } from "@shared/schema";
import { storage } from "../storage";
import { db } from "../db";
import multer from "multer";

// ============================================================================
// MULTER CONFIG (5MB for ingredient photos)
// ============================================================================

const cookingUpload = multer({
  limits: { fileSize: 5 * 1024 * 1024 },
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    const allowedMimes = ["image/jpeg", "image/png", "image/webp"];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Invalid file type. Only JPEG, PNG, and WebP allowed."));
    }
  },
});

// ============================================================================
// RATE LIMITERS
// ============================================================================

const cookingPhotoRateLimit = createRateLimiter({
  windowMs: 60 * 1000,
  max: 10,
  message: "Too many cooking photo uploads. Please wait.",
});

const substitutionRateLimit = createRateLimiter({
  windowMs: 60 * 1000,
  max: 5,
  message: "Too many substitution requests. Please wait.",
});

// ============================================================================
// SESSION STORE (in-memory, 3-map pattern from photos.ts)
// ============================================================================

interface CookingSessionPhoto {
  id: string;
  addedAt: number;
}

interface CookingSession {
  id: string;
  userId: string;
  ingredients: CookingSessionIngredient[];
  photos: CookingSessionPhoto[];
  createdAt: number;
}

const cookSessionStore = new Map<string, CookingSession>();
const cookSessionTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
const userCookSessionCount = new Map<string, number>();

const MAX_PHOTOS_PER_SESSION = 10;
const MAX_INGREDIENTS_PER_SESSION = 20;
const MAX_SESSIONS_PER_USER = 2;
const MAX_SESSIONS_GLOBAL = 1000;
const COOK_SESSION_TIMEOUT = 30 * 60 * 1000;

function clearCookSession(sessionId: string): void {
  const session = cookSessionStore.get(sessionId);
  const timeout = cookSessionTimeouts.get(sessionId);
  if (timeout) {
    clearTimeout(timeout);
    cookSessionTimeouts.delete(sessionId);
  }
  cookSessionStore.delete(sessionId);
  if (session) {
    const count = userCookSessionCount.get(session.userId) || 0;
    if (count > 1) {
      userCookSessionCount.set(session.userId, count - 1);
    } else {
      userCookSessionCount.delete(session.userId);
    }
  }
}

function resetSessionTimeout(sessionId: string): void {
  const existing = cookSessionTimeouts.get(sessionId);
  if (existing) clearTimeout(existing);
  const timeoutId = setTimeout(() => {
    clearCookSession(sessionId);
  }, COOK_SESSION_TIMEOUT);
  cookSessionTimeouts.set(sessionId, timeoutId);
}

function getSessionForUser(
  req: Request,
  res: Response,
  sessionId: string | undefined,
): CookingSession | null {
  if (!sessionId) {
    sendError(res, 400, "Session ID is required", ErrorCode.VALIDATION_ERROR);
    return null;
  }
  const session = cookSessionStore.get(sessionId);
  if (!session) {
    sendError(res, 404, "Cooking session not found", "SESSION_NOT_FOUND");
    return null;
  }
  if (session.userId !== req.userId) {
    sendError(res, 403, "Not your cooking session", ErrorCode.UNAUTHORIZED);
    return null;
  }
  return session;
}

// ============================================================================
// INGREDIENT ANALYSIS PROMPT
// ============================================================================

const INGREDIENT_ANALYSIS_PROMPT = `You are a nutrition assistant analyzing photos of raw cooking ingredients.

Identify each distinct ingredient visible in the photo(s). For each ingredient provide:
1. Name (specific: "chicken breast" not "chicken")
2. Estimated quantity in a numeric value
3. Unit (e.g., "g", "oz", "cup", "piece", "medium")
4. Your confidence level (0-1)
5. Food category: one of "protein", "vegetable", "grain", "fruit", "dairy", "beverage", "other"

Rules:
- Focus on RAW INGREDIENTS, not prepared dishes
- Use metric or US standard units
- If quantity is uncertain, provide your best estimate with lower confidence
- Be specific with cuts and forms (e.g., "diced onion", "boneless chicken thigh")

${SYSTEM_PROMPT_BOUNDARY}

Respond with JSON only matching this schema:
{
  "ingredients": [
    {
      "name": "ingredient name",
      "quantity": 200,
      "unit": "g",
      "confidence": 0.85,
      "category": "protein"
    }
  ]
}`;

// ============================================================================
// TEST INTERNALS
// ============================================================================

export const _testInternals = {
  cookSessionStore,
  cookSessionTimeouts,
  userCookSessionCount,
  clearCookSession,
  resetSessionTimeout,
  MAX_PHOTOS_PER_SESSION,
  MAX_INGREDIENTS_PER_SESSION,
  MAX_SESSIONS_PER_USER,
  MAX_SESSIONS_GLOBAL,
  COOK_SESSION_TIMEOUT,
};

// ============================================================================
// ROUTE REGISTRATION
// ============================================================================

export function register(app: Express): void {
  // --- Create session ---
  app.post(
    "/api/cooking/sessions",
    requireAuth,
    cookingPhotoRateLimit,
    async (req: Request, res: Response) => {
      try {
        const features = await checkPremiumFeature(
          req,
          res,
          "cookAndTrack",
          "Cook & Track",
        );
        if (!features) return;

        if (cookSessionStore.size >= MAX_SESSIONS_GLOBAL) {
          return sendError(
            res,
            429,
            "Server is busy, please try again later",
            "SESSION_LIMIT_REACHED",
          );
        }

        const currentUserSessions = userCookSessionCount.get(req.userId!) ?? 0;
        if (currentUserSessions >= MAX_SESSIONS_PER_USER) {
          return sendError(
            res,
            429,
            "Too many active cooking sessions. Please finish or wait for existing sessions to expire.",
            "USER_SESSION_LIMIT",
          );
        }

        const sessionId = crypto.randomUUID();
        const session: CookingSession = {
          id: sessionId,
          userId: req.userId!,
          ingredients: [],
          photos: [],
          createdAt: Date.now(),
        };

        cookSessionStore.set(sessionId, session);
        userCookSessionCount.set(req.userId!, currentUserSessions + 1);
        resetSessionTimeout(sessionId);

        res.status(201).json({
          id: sessionId,
          ingredients: [],
          photos: [],
          createdAt: session.createdAt,
        });
      } catch (error) {
        console.error("Create cooking session error:", error);
        sendError(
          res,
          500,
          "Failed to create cooking session",
          ErrorCode.INTERNAL_ERROR,
        );
      }
    },
  );

  // --- Get session ---
  app.get(
    "/api/cooking/sessions/:id",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const session = getSessionForUser(
          req,
          res,
          parseStringParam(req.params.id),
        );
        if (!session) return;

        res.json({
          id: session.id,
          ingredients: session.ingredients,
          photos: session.photos,
          createdAt: session.createdAt,
        });
      } catch (error) {
        console.error("Get cooking session error:", error);
        sendError(
          res,
          500,
          "Failed to get cooking session",
          ErrorCode.INTERNAL_ERROR,
        );
      }
    },
  );

  // --- Add photo (multer multipart) ---
  app.post(
    "/api/cooking/sessions/:id/photos",
    requireAuth,
    cookingPhotoRateLimit,
    cookingUpload.single("photo"),
    async (req: Request, res: Response) => {
      try {
        const session = getSessionForUser(
          req,
          res,
          parseStringParam(req.params.id),
        );
        if (!session) return;

        if (session.photos.length >= MAX_PHOTOS_PER_SESSION) {
          return sendError(
            res,
            400,
            `Maximum ${MAX_PHOTOS_PER_SESSION} photos per session`,
            ErrorCode.VALIDATION_ERROR,
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

        const imageBase64 = req.file.buffer.toString("base64");
        const photoId = crypto.randomUUID();

        // Call GPT-4o Vision to detect ingredients
        const completion = await openai.chat.completions.create(
          {
            model: "gpt-4o",
            messages: [
              { role: "system", content: INGREDIENT_ANALYSIS_PROMPT },
              {
                role: "user",
                content: [
                  {
                    type: "image_url",
                    image_url: {
                      url: `data:${req.file.mimetype};base64,${imageBase64}`,
                      detail: session.photos.length >= 4 ? "low" : "high",
                    },
                  },
                ],
              },
            ],
            response_format: { type: "json_object" },
            max_tokens: 1000,
          },
          { timeout: OPENAI_TIMEOUT_HEAVY_MS },
        );

        const rawContent = completion.choices[0]?.message?.content;
        if (!rawContent) {
          return sendError(
            res,
            500,
            "No response from ingredient analysis",
            ErrorCode.INTERNAL_ERROR,
          );
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(rawContent);
        } catch {
          return sendError(
            res,
            500,
            "Invalid JSON from ingredient analysis",
            ErrorCode.INTERNAL_ERROR,
          );
        }

        const validated = photoAnalysisResponseSchema.safeParse(parsed);
        if (!validated.success) {
          console.error(
            "Ingredient analysis validation failed:",
            validated.error.format(),
          );
          return sendError(
            res,
            500,
            "Unexpected response format from ingredient analysis",
            ErrorCode.INTERNAL_ERROR,
          );
        }

        // Merge detected ingredients into session
        const newIngredients: CookingSessionIngredient[] =
          validated.data.ingredients.map((detected) => ({
            id: crypto.randomUUID(),
            name: detected.name,
            quantity: detected.quantity,
            unit: detected.unit,
            confidence: detected.confidence,
            category: detected.category as FoodCategory,
            photoId,
            userEdited: false,
          }));

        // Simple dedup: if exact name match exists and not userEdited, update quantity
        for (const newItem of newIngredients) {
          const existingIndex = session.ingredients.findIndex(
            (i) =>
              i.name.toLowerCase() === newItem.name.toLowerCase() &&
              !i.userEdited,
          );
          if (existingIndex !== -1) {
            session.ingredients[existingIndex].quantity += newItem.quantity;
            session.ingredients[existingIndex].confidence = Math.max(
              session.ingredients[existingIndex].confidence,
              newItem.confidence,
            );
          } else if (session.ingredients.length < MAX_INGREDIENTS_PER_SESSION) {
            session.ingredients.push(newItem);
          }
        }

        session.photos.push({ id: photoId, addedAt: Date.now() });
        resetSessionTimeout(session.id);

        // Auto-detect allergens in the session's ingredients
        let allergenWarnings: AllergenMatch[] = [];
        try {
          const profile = await storage.getUserProfile(req.userId!);
          const userAllergies = parseUserAllergies(profile?.allergies);
          if (userAllergies.length > 0) {
            const ingredientNames = session.ingredients.map((i) => i.name);
            allergenWarnings = detectAllergens(ingredientNames, userAllergies);
          }
        } catch {
          // Non-critical — session still works without warnings
        }

        res.json({
          id: session.id,
          ingredients: session.ingredients,
          photos: session.photos,
          createdAt: session.createdAt,
          newDetections: newIngredients.length,
          allergenWarnings,
        });
      } catch (error) {
        console.error("Add cooking photo error:", error);
        sendError(
          res,
          500,
          "Failed to analyze ingredient photo",
          ErrorCode.INTERNAL_ERROR,
        );
      }
    },
  );

  // --- Edit ingredient ---
  app.patch(
    "/api/cooking/sessions/:id/ingredients/:ingredientId",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const session = getSessionForUser(
          req,
          res,
          parseStringParam(req.params.id),
        );
        if (!session) return;

        const ingredientId = parseStringParam(req.params.ingredientId);
        const ingredient = session.ingredients.find(
          (i) => i.id === ingredientId,
        );
        if (!ingredient) {
          return sendError(
            res,
            404,
            "Ingredient not found",
            "INGREDIENT_NOT_FOUND",
          );
        }

        const parsed = ingredientEditSchema.safeParse(req.body);
        if (!parsed.success) {
          return sendError(
            res,
            400,
            formatZodError(parsed.error),
            ErrorCode.VALIDATION_ERROR,
          );
        }

        const updates = parsed.data;
        if (updates.name !== undefined) ingredient.name = updates.name;
        if (updates.quantity !== undefined)
          ingredient.quantity = updates.quantity;
        if (updates.unit !== undefined) ingredient.unit = updates.unit;
        if (updates.preparationMethod !== undefined)
          ingredient.preparationMethod = updates.preparationMethod;
        ingredient.userEdited = true;

        resetSessionTimeout(session.id);

        res.json({ ingredient });
      } catch (error) {
        console.error("Edit ingredient error:", error);
        sendError(
          res,
          500,
          "Failed to edit ingredient",
          ErrorCode.INTERNAL_ERROR,
        );
      }
    },
  );

  // --- Delete ingredient ---
  app.delete(
    "/api/cooking/sessions/:id/ingredients/:ingredientId",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const session = getSessionForUser(
          req,
          res,
          parseStringParam(req.params.id),
        );
        if (!session) return;

        const ingredientId = parseStringParam(req.params.ingredientId);
        const index = session.ingredients.findIndex(
          (i) => i.id === ingredientId,
        );
        if (index === -1) {
          return sendError(
            res,
            404,
            "Ingredient not found",
            "INGREDIENT_NOT_FOUND",
          );
        }

        session.ingredients.splice(index, 1);
        resetSessionTimeout(session.id);

        res.json({ ingredients: session.ingredients });
      } catch (error) {
        console.error("Delete ingredient error:", error);
        sendError(
          res,
          500,
          "Failed to delete ingredient",
          ErrorCode.INTERNAL_ERROR,
        );
      }
    },
  );

  // --- Nutrition summary ---
  app.post(
    "/api/cooking/sessions/:id/nutrition",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const session = getSessionForUser(
          req,
          res,
          parseStringParam(req.params.id),
        );
        if (!session) return;

        if (session.ingredients.length === 0) {
          return sendError(
            res,
            400,
            "No ingredients in session",
            ErrorCode.VALIDATION_ERROR,
          );
        }

        const parsed = nutritionRequestSchema.safeParse(req.body);
        if (!parsed.success) {
          return sendError(
            res,
            400,
            formatZodError(parsed.error),
            ErrorCode.VALIDATION_ERROR,
          );
        }

        const globalCookingMethod = parsed.data.cookingMethod;

        // Build lookup queries: "quantity unit name"
        const lookupQueries = session.ingredients.map(
          (i) => `${i.quantity} ${i.unit} ${i.name}`,
        );

        const nutritionMap = await batchNutritionLookup(lookupQueries);

        const items: CookSessionNutritionItem[] = [];
        const total = {
          calories: 0,
          protein: 0,
          carbs: 0,
          fat: 0,
          fiber: 0,
          sugar: 0,
          sodium: 0,
        };

        for (let i = 0; i < session.ingredients.length; i++) {
          const ingredient = session.ingredients[i];
          const query = lookupQueries[i];
          const nutrition = nutritionMap.get(query);

          if (!nutrition) {
            items.push({
              ingredientId: ingredient.id,
              name: ingredient.name,
              calories: 0,
              protein: 0,
              carbs: 0,
              fat: 0,
              fiber: 0,
              sugar: 0,
              sodium: 0,
              servingSize: `${ingredient.quantity} ${ingredient.unit}`,
            });
            continue;
          }

          // Apply cooking method adjustment if specified
          const methodStr = ingredient.preparationMethod || globalCookingMethod;
          let finalNutrition = {
            calories: nutrition.calories,
            protein: nutrition.protein,
            carbs: nutrition.carbs,
            fat: nutrition.fat,
            fiber: nutrition.fiber,
            sugar: nutrition.sugar,
            sodium: nutrition.sodium,
          };

          let appliedMethod: string | undefined;
          if (methodStr && methodStr !== "raw" && methodStr !== "As Served") {
            const cookingMethod = preparationToCookingMethod(methodStr);
            const cooked = calculateCookedNutrition(
              {
                calories: nutrition.calories,
                protein: nutrition.protein,
                carbs: nutrition.carbs,
                fat: nutrition.fat,
                fiber: nutrition.fiber,
                sugar: nutrition.sugar,
                sodium: nutrition.sodium,
              },
              ingredient.quantity,
              ingredient.category,
              cookingMethod,
            );

            if (cooked.adjustmentApplied) {
              finalNutrition = {
                calories: cooked.calories,
                protein: cooked.protein,
                carbs: cooked.carbs,
                fat: cooked.fat,
                fiber: cooked.fiber,
                sugar: cooked.sugar,
                sodium: cooked.sodium,
              };
              appliedMethod = cookingMethod;
            }
          }

          const item: CookSessionNutritionItem = {
            ingredientId: ingredient.id,
            name: ingredient.name,
            calories: finalNutrition.calories,
            protein: finalNutrition.protein,
            carbs: finalNutrition.carbs,
            fat: finalNutrition.fat,
            fiber: finalNutrition.fiber,
            sugar: finalNutrition.sugar,
            sodium: finalNutrition.sodium,
            servingSize: `${ingredient.quantity} ${ingredient.unit}`,
            cookingMethodApplied: appliedMethod,
          };
          items.push(item);

          total.calories += item.calories;
          total.protein += item.protein;
          total.carbs += item.carbs;
          total.fat += item.fat;
          total.fiber += item.fiber;
          total.sugar += item.sugar;
          total.sodium += item.sodium;
        }

        // Round totals
        total.calories = Math.round(total.calories);
        total.protein = Math.round(total.protein * 10) / 10;
        total.carbs = Math.round(total.carbs * 10) / 10;
        total.fat = Math.round(total.fat * 10) / 10;
        total.fiber = Math.round(total.fiber * 10) / 10;
        total.sugar = Math.round(total.sugar * 10) / 10;
        total.sodium = Math.round(total.sodium);

        const summary: CookSessionNutritionSummary = { total, items };
        res.json(summary);
      } catch (error) {
        console.error("Nutrition summary error:", error);
        sendError(
          res,
          500,
          "Failed to calculate nutrition",
          ErrorCode.INTERNAL_ERROR,
        );
      }
    },
  );

  // --- Log meal ---
  app.post(
    "/api/cooking/sessions/:id/log",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const session = getSessionForUser(
          req,
          res,
          parseStringParam(req.params.id),
        );
        if (!session) return;

        if (session.ingredients.length === 0) {
          return sendError(
            res,
            400,
            "No ingredients to log",
            ErrorCode.VALIDATION_ERROR,
          );
        }

        const parsed = logRequestSchema.safeParse(req.body);
        if (!parsed.success) {
          return sendError(
            res,
            400,
            formatZodError(parsed.error),
            ErrorCode.VALIDATION_ERROR,
          );
        }

        // Get nutrition data for totals
        const lookupQueries = session.ingredients.map(
          (i) => `${i.quantity} ${i.unit} ${i.name}`,
        );
        const nutritionMap = await batchNutritionLookup(lookupQueries);

        const totals = { calories: 0, protein: 0, carbs: 0, fat: 0 };
        for (let i = 0; i < session.ingredients.length; i++) {
          const nutrition = nutritionMap.get(lookupQueries[i]);
          if (nutrition) {
            totals.calories += nutrition.calories;
            totals.protein += nutrition.protein;
            totals.carbs += nutrition.carbs;
            totals.fat += nutrition.fat;
          }
        }

        // Composite product name (like photos.ts line 430)
        const productName = session.ingredients.map((i) => i.name).join(", ");

        // Log as single composite scannedItem + dailyLog
        const [scannedItem] = await db.transaction(async (tx) => {
          const [item] = await tx
            .insert(scannedItems)
            .values({
              userId: req.userId!,
              productName,
              calories: Math.round(totals.calories).toString(),
              protein: Math.round(totals.protein).toString(),
              carbs: Math.round(totals.carbs).toString(),
              fat: Math.round(totals.fat).toString(),
              sourceType: "cook_session",
            })
            .returning();

          await tx.insert(dailyLogs).values({
            userId: req.userId!,
            scannedItemId: item.id,
            servings: "1",
            mealType: parsed.data.mealType || null,
          });

          return [item];
        });

        // Clean up session after successful log
        clearCookSession(session.id);

        res.status(201).json(scannedItem);
      } catch (error) {
        console.error("Log cooking session error:", error);
        sendError(res, 500, "Failed to log meal", ErrorCode.INTERNAL_ERROR);
      }
    },
  );

  // --- Generate recipe ---
  app.post(
    "/api/cooking/sessions/:id/recipe",
    requireAuth,
    cookingPhotoRateLimit,
    async (req: Request, res: Response) => {
      try {
        const features = await checkPremiumFeature(
          req,
          res,
          "recipeGeneration",
          "Recipe generation",
        );
        if (!features) return;

        const session = getSessionForUser(
          req,
          res,
          parseStringParam(req.params.id),
        );
        if (!session) return;

        if (session.ingredients.length === 0) {
          return sendError(
            res,
            400,
            "No ingredients for recipe",
            ErrorCode.VALIDATION_ERROR,
          );
        }

        const ingredientList = session.ingredients
          .map((i) => `${i.quantity} ${i.unit} ${i.name}`)
          .join(", ");

        // Get user profile for dietary context
        const userProfile = await storage.getUserProfile(req.userId!);

        const recipe = await generateRecipeContent({
          productName: ingredientList,
          userProfile,
        });

        res.json(recipe);
      } catch (error) {
        console.error("Generate recipe from session error:", error);
        sendError(
          res,
          500,
          "Failed to generate recipe",
          ErrorCode.INTERNAL_ERROR,
        );
      }
    },
  );

  // --- Get substitution suggestions ---
  app.post(
    "/api/cooking/sessions/:id/substitutions",
    requireAuth,
    substitutionRateLimit,
    async (req: Request, res: Response) => {
      try {
        const session = getSessionForUser(
          req,
          res,
          parseStringParam(req.params.id),
        );
        if (!session) return;

        if (session.ingredients.length === 0) {
          return sendError(
            res,
            400,
            "No ingredients for substitutions",
            ErrorCode.VALIDATION_ERROR,
          );
        }

        const parsed = substitutionRequestSchema.safeParse(req.body);
        if (!parsed.success) {
          return sendError(
            res,
            400,
            formatZodError(parsed.error),
            ErrorCode.VALIDATION_ERROR,
          );
        }

        // Filter to requested ingredients or use all
        const targetIngredients = parsed.data.ingredientIds
          ? session.ingredients.filter((i) =>
              parsed.data.ingredientIds!.includes(i.id),
            )
          : session.ingredients;

        if (targetIngredients.length === 0) {
          return sendError(
            res,
            400,
            "No matching ingredients found",
            ErrorCode.VALIDATION_ERROR,
          );
        }

        const userProfile = await storage.getUserProfile(req.userId!);
        const result = await getSubstitutions(targetIngredients, userProfile);

        res.json(result);
      } catch (error) {
        console.error("Substitution suggestions error:", error);
        sendError(
          res,
          500,
          "Failed to get substitutions",
          ErrorCode.INTERNAL_ERROR,
        );
      }
    },
  );
}
