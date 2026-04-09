import type { Express, Response } from "express";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth";
import { sendError } from "../lib/api-errors";
import { ErrorCode } from "@shared/constants/error-codes";
import { crudRateLimit, createRateLimiter } from "./_rate-limiters";
import { createImageUpload } from "./_upload";
import {
  formatZodError,
  checkPremiumFeature,
  checkAiConfigured,
  handleRouteError,
  parseStringParam,
} from "./_helpers";
import {
  ingredientEditSchema,
  nutritionRequestSchema,
  logRequestSchema,
  substitutionRequestSchema,
  type CookingSessionIngredient,
} from "@shared/types/cook-session";
import {
  mergeDetectedIngredients,
  MAX_INGREDIENTS_PER_SESSION,
} from "../lib/cook-session-merge";
import {
  analyzeIngredientPhoto,
  IngredientAnalysisError,
  calculateSessionNutrition,
  calculateSessionMacros,
} from "../services/cooking-session";
import { generateRecipeContent } from "../services/recipe-generation";
import { getSubstitutions } from "../services/ingredient-substitution";
import {
  detectAllergens,
  parseUserAllergies,
  type AllergenMatch,
} from "@shared/constants/allergens";

import { storage, type CookingSession } from "../storage";
import {
  COOKING_MAX_PER_USER,
  COOKING_MAX_GLOBAL,
  COOKING_TIMEOUT_MS,
} from "../storage/sessions";

// ============================================================================
// MULTER CONFIG (5MB for ingredient photos)
// ============================================================================

const cookingUpload = createImageUpload(5 * 1024 * 1024);

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
// SESSION STORE — uses canonical instance from storage/sessions.ts
// ============================================================================

const MAX_PHOTOS_PER_SESSION = 10;

const cookStore = storage.cookingSessionStore;

// Aliases for backward compatibility with route code and tests
const clearCookSession = cookStore.clear;
const resetSessionTimeout = cookStore.resetTimeout;

function getSessionForUser(
  req: AuthenticatedRequest,
  res: Response,
  sessionId: string | undefined,
): CookingSession | null {
  if (!sessionId) {
    sendError(res, 400, "Session ID is required", ErrorCode.VALIDATION_ERROR);
    return null;
  }
  const session = cookStore.get(sessionId);
  if (!session) {
    sendError(
      res,
      404,
      "Cooking session not found",
      ErrorCode.SESSION_NOT_FOUND,
    );
    return null;
  }
  if (session.userId !== req.userId) {
    sendError(
      res,
      404,
      "Cooking session not found",
      ErrorCode.SESSION_NOT_FOUND,
    );
    return null;
  }
  return session;
}

// ============================================================================
// TEST INTERNALS
// ============================================================================

export const _testInternals = {
  cookSessionStore: cookStore._internals.store,
  cookSessionTimeouts: cookStore._internals.timeouts,
  userCookSessionCount: cookStore._internals.userCount,
  clearCookSession: cookStore.clear,
  resetSessionTimeout: cookStore.resetTimeout,
  MAX_PHOTOS_PER_SESSION,
  MAX_INGREDIENTS_PER_SESSION,
  MAX_SESSIONS_PER_USER: COOKING_MAX_PER_USER,
  MAX_SESSIONS_GLOBAL: COOKING_MAX_GLOBAL,
  COOK_SESSION_TIMEOUT: COOKING_TIMEOUT_MS,
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
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const features = await checkPremiumFeature(
          req,
          res,
          "cookAndTrack",
          "Cook & Track",
        );
        if (!features) return;

        const check = cookStore.canCreate(req.userId);
        if (!check.allowed) {
          return sendError(res, 429, check.reason, check.code);
        }

        const sessionId = cookStore.create({
          id: "", // auto-set by factory to match store key
          userId: req.userId,
          ingredients: [],
          photos: [],
          createdAt: Date.now(),
        });
        const session = cookStore.get(sessionId)!;

        res.status(201).json({
          id: sessionId,
          ingredients: [],
          photos: [],
          createdAt: session.createdAt,
        });
      } catch (error) {
        handleRouteError(res, error, "create cooking session");
      }
    },
  );

  // --- Get session ---
  app.get(
    "/api/cooking/sessions/:id",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
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
        handleRouteError(res, error, "get cooking session");
      }
    },
  );

  // --- Add photo (multer multipart) ---
  app.post(
    "/api/cooking/sessions/:id/photos",
    requireAuth,
    cookingPhotoRateLimit,
    cookingUpload.single("photo"),
    async (req: AuthenticatedRequest, res: Response) => {
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

        if (!checkAiConfigured(res)) return;

        const imageBase64 = req.file.buffer.toString("base64");
        const photoId = crypto.randomUUID();

        let newIngredients: CookingSessionIngredient[];
        try {
          newIngredients = await analyzeIngredientPhoto(
            imageBase64,
            req.file.mimetype,
            session.photos.length,
          );
          // Set the real photoId on each detected ingredient
          for (const ingredient of newIngredients) {
            ingredient.photoId = photoId;
          }
        } catch (error) {
          if (error instanceof IngredientAnalysisError) {
            return sendError(res, 500, error.message, ErrorCode.INTERNAL_ERROR);
          }
          throw error;
        }

        session.ingredients = mergeDetectedIngredients(
          session.ingredients,
          newIngredients,
          MAX_INGREDIENTS_PER_SESSION,
        );

        session.photos.push({ id: photoId, addedAt: Date.now() });
        resetSessionTimeout(session.id);

        // Auto-detect allergens in the session's ingredients
        let allergenWarnings: AllergenMatch[] = [];
        try {
          const profile = await storage.getUserProfile(req.userId);
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
        handleRouteError(res, error, "add cooking photo");
      }
    },
  );

  // --- Edit ingredient ---
  app.patch(
    "/api/cooking/sessions/:id/ingredients/:ingredientId",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
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
            ErrorCode.INGREDIENT_NOT_FOUND,
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
        handleRouteError(res, error, "edit ingredient");
      }
    },
  );

  // --- Delete ingredient ---
  app.delete(
    "/api/cooking/sessions/:id/ingredients/:ingredientId",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
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
            ErrorCode.INGREDIENT_NOT_FOUND,
          );
        }

        session.ingredients.splice(index, 1);
        resetSessionTimeout(session.id);

        res.json({ ingredients: session.ingredients });
      } catch (error) {
        handleRouteError(res, error, "delete ingredient");
      }
    },
  );

  // --- Nutrition summary ---
  app.post(
    "/api/cooking/sessions/:id/nutrition",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
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

        const summary = await calculateSessionNutrition(
          session.ingredients,
          parsed.data.cookingMethod,
        );
        res.json(summary);
      } catch (error) {
        handleRouteError(res, error, "nutrition summary");
      }
    },
  );

  // --- Log meal ---
  app.post(
    "/api/cooking/sessions/:id/log",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
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
        const totals = await calculateSessionMacros(session.ingredients);

        // Composite product name (like photos.ts line 430)
        const productName = session.ingredients.map((i) => i.name).join(", ");

        // Log as single composite scannedItem + dailyLog
        const scannedItem = await storage.createScannedItemWithLog(
          {
            userId: req.userId,
            productName,
            calories: totals.calories.toString(),
            protein: totals.protein.toString(),
            carbs: totals.carbs.toString(),
            fat: totals.fat.toString(),
            sourceType: "cook_session",
          },
          { mealType: parsed.data.mealType || null },
        );

        // Clean up session after successful log
        clearCookSession(session.id);

        res.status(201).json(scannedItem);
      } catch (error) {
        handleRouteError(res, error, "log cooking session");
      }
    },
  );

  // --- Generate recipe ---
  app.post(
    "/api/cooking/sessions/:id/recipe",
    requireAuth,
    cookingPhotoRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
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

        if (!checkAiConfigured(res)) return;

        // Get user profile for dietary context
        const userProfile = await storage.getUserProfile(req.userId);

        const recipe = await generateRecipeContent({
          productName: ingredientList,
          userProfile,
        });

        res.json(recipe);
      } catch (error) {
        handleRouteError(res, error, "generate recipe from session");
      }
    },
  );

  // --- Get substitution suggestions ---
  app.post(
    "/api/cooking/sessions/:id/substitutions",
    requireAuth,
    substitutionRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
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

        const userProfile = await storage.getUserProfile(req.userId);
        const result = await getSubstitutions(targetIngredients, userProfile);

        res.json(result);
      } catch (error) {
        handleRouteError(res, error, "substitution suggestions");
      }
    },
  );
}
