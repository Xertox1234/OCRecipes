import type { Express, Request, Response } from "express";
import { createServer, type Server } from "node:http";
import crypto from "crypto";
import bcrypt from "bcrypt";
import OpenAI from "openai";
import { rateLimit } from "express-rate-limit";
import { z, ZodError } from "zod";
import multer, { MulterError } from "multer";
import { storage } from "./storage";
import { db } from "./db";
import { requireAuth, generateToken } from "./middleware/auth";
import {
  insertUserProfileSchema,
  insertScannedItemSchema,
  allergySchema,
  scannedItems,
  dailyLogs,
  userProfiles,
  users,
  type Allergy,
} from "@shared/schema";
import { createSavedItemSchema } from "@shared/schemas/saved-items";
import { eq } from "drizzle-orm";
import {
  TIER_FEATURES,
  subscriptionTiers,
  type SubscriptionTier,
  type SubscriptionStatus,
} from "@shared/types/premium";
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
} from "./services/photo-analysis";
import {
  batchNutritionLookup,
  lookupNutrition,
  lookupBarcode,
} from "./services/nutrition-lookup";
import {
  calculateGoals,
  userPhysicalProfileSchema,
} from "./services/goal-calculator";
import { calculateProfileHash } from "./utils/profile-hash";
import {
  generateFullRecipe,
  normalizeProductName,
} from "./services/recipe-generation";
import {
  searchCatalogRecipes,
  getCatalogRecipeDetail,
  CatalogQuotaError,
} from "./services/recipe-catalog";
import { importRecipeFromUrl } from "./services/recipe-import";
import { validateReceipt } from "./services/receipt-validation";
import {
  UpgradeRequestSchema,
  RestoreRequestSchema,
} from "@shared/schemas/subscription";
import { sendError } from "./lib/api-errors";
import {
  generateMealSuggestions,
  buildSuggestionCacheKey,
} from "./services/meal-suggestions";
import { generateGroceryItems } from "./services/grocery-generation";
import type { MealSuggestion } from "@shared/types/meal-suggestions";

import { isValidCalendarDate } from "./utils/date-validation";

/**
 * Type guard to validate if a string is a valid subscription tier.
 * Prevents unsafe type assertions that could cause runtime errors.
 */
function isValidSubscriptionTier(tier: string): tier is SubscriptionTier {
  return (subscriptionTiers as readonly string[]).includes(tier);
}
export { isValidCalendarDate };

/** Extract IP address for rate limiting fallback when user is not authenticated */
function ipKeyGenerator(req: Request): string {
  return req.ip || req.socket.remoteAddress || "unknown";
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 attempts per window
  message: { error: "Too many login attempts, please try again later" },
  standardHeaders: true,
  legacyHeaders: false,
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // 5 registrations per hour
  message: { error: "Too many registration attempts, please try again later" },
  standardHeaders: true,
  legacyHeaders: false,
});

const photoRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 requests per minute
  message: { error: "Too many photo uploads. Please wait." },
  keyGenerator: (req) => req.userId || ipKeyGenerator(req),
  standardHeaders: true,
  legacyHeaders: false,
});

const instructionsRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20, // 20 requests per minute per user
  message: { error: "Too many instruction requests. Please wait." },
  keyGenerator: (req) => req.userId || ipKeyGenerator(req),
  standardHeaders: true,
  legacyHeaders: false,
});

const nutritionLookupRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 15, // 15 requests per minute per user
  message: { error: "Too many nutrition lookups. Please wait." },
  keyGenerator: (req) => req.userId || ipKeyGenerator(req),
  standardHeaders: true,
  legacyHeaders: false,
});

const subscriptionRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 attempts per window
  message: { error: "Too many subscription requests. Please wait." },
  keyGenerator: (req) => req.userId || ipKeyGenerator(req),
  standardHeaders: true,
  legacyHeaders: false,
});

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

// Registration validation schema with username format and password strength
const registerSchema = z.object({
  username: z
    .string()
    .min(3, "Username must be at least 3 characters")
    .max(30, "Username must be at most 30 characters")
    .regex(
      /^[a-zA-Z0-9_]+$/,
      "Username can only contain letters, numbers, and underscores",
    ),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

// Profile update validation schema
const profileUpdateSchema = z.object({
  displayName: z.string().max(100).optional(),
  dailyCalorieGoal: z.number().int().min(500).max(10000).optional(),
  onboardingCompleted: z.boolean().optional(),
});

// Enhanced user profile schema with proper validation for nested objects
const userProfileInputSchema = insertUserProfileSchema.extend({
  allergies: z.array(allergySchema).optional(),
  healthConditions: z.array(z.string()).optional(),
  foodDislikes: z.array(z.string()).optional(),
  cuisinePreferences: z.array(z.string()).optional(),
  householdSize: z.number().int().min(1).max(20).optional(),
  dietType: z.string().max(50).optional().nullable(),
  primaryGoal: z.string().max(100).optional().nullable(),
  activityLevel: z.string().max(50).optional().nullable(),
  cookingSkillLevel: z.string().max(50).optional().nullable(),
  cookingTimeAvailable: z.string().max(50).optional().nullable(),
});

// Format Zod validation errors as a simple string
function formatZodError(error: ZodError): string {
  return error.errors
    .map((e) =>
      e.path.length ? `${e.path.join(".")}: ${e.message}` : e.message,
    )
    .join("; ");
}

export async function registerRoutes(app: Express): Promise<Server> {
  app.post(
    "/api/auth/register",
    registerLimiter,
    async (req: Request, res: Response) => {
      try {
        const validated = registerSchema.parse(req.body);

        const existingUser = await storage.getUserByUsername(
          validated.username,
        );
        if (existingUser) {
          return res.status(409).json({ error: "Username already exists" });
        }

        const hashedPassword = await bcrypt.hash(validated.password, 10);
        const user = await storage.createUser({
          username: validated.username,
          password: hashedPassword,
        });

        const token = generateToken(user.id.toString());

        res.status(201).json({
          user: {
            id: user.id,
            username: user.username,
            displayName: user.displayName,
            avatarUrl: user.avatarUrl,
            dailyCalorieGoal: user.dailyCalorieGoal,
            onboardingCompleted: user.onboardingCompleted,
            subscriptionTier: user.subscriptionTier || "free",
          },
          token,
        });
      } catch (error) {
        if (error instanceof ZodError) {
          return res.status(400).json({ error: formatZodError(error) });
        }
        console.error("Registration error:", error);
        res.status(500).json({ error: "Failed to create account" });
      }
    },
  );

  app.post(
    "/api/auth/login",
    loginLimiter,
    async (req: Request, res: Response) => {
      try {
        const { username, password } = req.body;

        if (!username || !password) {
          return res
            .status(400)
            .json({ error: "Username and password are required" });
        }

        const user = await storage.getUserByUsername(username);
        if (!user) {
          return res.status(401).json({ error: "Invalid credentials" });
        }

        const isValidPassword = await bcrypt.compare(password, user.password);
        if (!isValidPassword) {
          return res.status(401).json({ error: "Invalid credentials" });
        }

        const token = generateToken(user.id.toString());

        res.json({
          user: {
            id: user.id,
            username: user.username,
            displayName: user.displayName,
            avatarUrl: user.avatarUrl,
            dailyCalorieGoal: user.dailyCalorieGoal,
            onboardingCompleted: user.onboardingCompleted,
            subscriptionTier: user.subscriptionTier || "free",
          },
          token,
        });
      } catch (error) {
        console.error("Login error:", error);
        res.status(500).json({ error: "Failed to login" });
      }
    },
  );

  app.post("/api/auth/logout", (_req: Request, res: Response) => {
    // Stateless JWT - no session to destroy
    res.json({ success: true });
  });

  app.get("/api/auth/me", requireAuth, async (req: Request, res: Response) => {
    const user = await storage.getUser(req.userId!);
    if (!user) {
      return res.status(401).json({ error: "User not found" });
    }

    res.json({
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      dailyCalorieGoal: user.dailyCalorieGoal,
      onboardingCompleted: user.onboardingCompleted,
      subscriptionTier: user.subscriptionTier || "free",
    });
  });

  app.put(
    "/api/auth/profile",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const validated = profileUpdateSchema.parse(req.body);
        const updates: Record<string, unknown> = {};
        if (validated.displayName !== undefined)
          updates.displayName = validated.displayName;
        if (validated.dailyCalorieGoal !== undefined)
          updates.dailyCalorieGoal = validated.dailyCalorieGoal;
        if (validated.onboardingCompleted !== undefined)
          updates.onboardingCompleted = validated.onboardingCompleted;

        if (Object.keys(updates).length === 0) {
          return res.status(400).json({ error: "No valid fields to update" });
        }

        const user = await storage.updateUser(req.userId!, updates);

        if (!user) {
          return res.status(404).json({ error: "User not found" });
        }

        res.json({
          id: user.id,
          username: user.username,
          displayName: user.displayName,
          avatarUrl: user.avatarUrl,
          dailyCalorieGoal: user.dailyCalorieGoal,
          onboardingCompleted: user.onboardingCompleted,
          subscriptionTier: user.subscriptionTier || "free",
        });
      } catch (error) {
        if (error instanceof ZodError) {
          return res.status(400).json({ error: formatZodError(error) });
        }
        console.error("Profile update error:", error);
        res.status(500).json({ error: "Failed to update profile" });
      }
    },
  );

  app.get(
    "/api/user/dietary-profile",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const profile = await storage.getUserProfile(req.userId!);
        res.json(profile || null);
      } catch (error) {
        console.error("Error fetching dietary profile:", error);
        res.status(500).json({ error: "Failed to fetch dietary profile" });
      }
    },
  );

  app.post(
    "/api/user/dietary-profile",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const validated = userProfileInputSchema.parse({
          ...req.body,
          userId: req.userId!,
        });

        const profileData = {
          allergies: validated.allergies,
          healthConditions: validated.healthConditions,
          dietType: validated.dietType,
          foodDislikes: validated.foodDislikes,
          primaryGoal: validated.primaryGoal,
          activityLevel: validated.activityLevel,
          householdSize: validated.householdSize,
          cuisinePreferences: validated.cuisinePreferences,
          cookingSkillLevel: validated.cookingSkillLevel,
          cookingTimeAvailable: validated.cookingTimeAvailable,
        };

        // Transaction: create/update profile + mark onboarding complete
        const profile = await db.transaction(async (tx) => {
          const [existing] = await tx
            .select()
            .from(userProfiles)
            .where(eq(userProfiles.userId, req.userId!));

          let result;
          if (existing) {
            [result] = await tx
              .update(userProfiles)
              .set({ ...profileData, updatedAt: new Date() })
              .where(eq(userProfiles.userId, req.userId!))
              .returning();
          } else {
            [result] = await tx
              .insert(userProfiles)
              .values({ ...profileData, userId: req.userId! })
              .returning();
          }

          await tx
            .update(users)
            .set({ onboardingCompleted: true })
            .where(eq(users.id, req.userId!));

          return result;
        });

        res.status(201).json(profile);
      } catch (error) {
        if (error instanceof ZodError) {
          return res.status(400).json({ error: formatZodError(error) });
        }
        console.error("Error saving dietary profile:", error);
        res.status(500).json({ error: "Failed to save dietary profile" });
      }
    },
  );

  // Fields that affect AI-generated suggestions - if any change, invalidate cache
  const cacheAffectingFields = [
    "allergies",
    "dietType",
    "cookingSkillLevel",
    "cookingTimeAvailable",
  ];

  app.put(
    "/api/user/dietary-profile",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        // For partial updates, make all fields optional
        const updateSchema = userProfileInputSchema
          .partial()
          .omit({ userId: true });
        const validated = updateSchema.parse(req.body);

        const profile = await storage.updateUserProfile(req.userId!, validated);

        if (!profile) {
          return res.status(404).json({ error: "Profile not found" });
        }

        // Invalidate suggestion cache if dietary-affecting fields changed
        // Fire-and-forget: don't block the response on cache invalidation
        const changedCacheFields = cacheAffectingFields.some(
          (f) => f in validated,
        );
        if (changedCacheFields) {
          storage
            .invalidateSuggestionCacheForUser(req.userId!)
            .catch(console.error);
        }

        res.json(profile);
      } catch (error) {
        if (error instanceof ZodError) {
          return res.status(400).json({ error: formatZodError(error) });
        }
        console.error("Error updating dietary profile:", error);
        res.status(500).json({ error: "Failed to update dietary profile" });
      }
    },
  );

  // Nutrition lookup by product name — used as fallback when OpenFoodFacts
  // returns only per-100g data without serving size information.
  app.get(
    "/api/nutrition/lookup",
    requireAuth,
    nutritionLookupRateLimit,
    async (req: Request, res: Response) => {
      const name = (req.query.name as string)?.trim();
      if (!name || name.length > 200) {
        res
          .status(400)
          .json({ error: "name query parameter is required (max 200 chars)" });
        return;
      }

      try {
        const result = await lookupNutrition(name);
        if (!result) {
          res.status(404).json({ error: "Nutrition data not found" });
          return;
        }
        res.json(result);
      } catch (error) {
        console.error("Nutrition lookup error:", error);
        res.status(500).json({ error: "Nutrition lookup failed" });
      }
    },
  );

  // Barcode nutrition lookup — fetches Open Food Facts product data and
  // cross-validates per-100g values with USDA FoodData Central.
  // This catches bad OFF data (e.g. sugar showing 50 kcal/100g when USDA says 375).
  app.get(
    "/api/nutrition/barcode/:code",
    requireAuth,
    nutritionLookupRateLimit,
    async (req: Request, res: Response) => {
      const code = req.params.code?.trim();
      if (!code || code.length > 50 || !/^\d+$/.test(code)) {
        res.status(400).json({ error: "Invalid barcode" });
        return;
      }

      try {
        const result = await lookupBarcode(code);
        if (!result) {
          res
            .status(404)
            .json({ error: "Product not found", notInDatabase: true });
          return;
        }
        res.json(result);
      } catch (error) {
        console.error("Barcode lookup error:", error);
        res.status(500).json({ error: "Barcode lookup failed" });
      }
    },
  );

  app.get(
    "/api/scanned-items",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const limit = Math.min(
          Math.max(parseInt(req.query.limit as string) || 50, 1),
          100,
        );
        const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);

        const result = await storage.getScannedItems(
          req.userId!,
          limit,
          offset,
        );
        res.json(result);
      } catch (error) {
        console.error("Error fetching scanned items:", error);
        res.status(500).json({ error: "Failed to fetch items" });
      }
    },
  );

  app.get(
    "/api/scanned-items/:id",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const id = parseInt(req.params.id as string, 10);
        if (isNaN(id) || id <= 0) {
          return res.status(400).json({ error: "Invalid item ID" });
        }

        const item = await storage.getScannedItem(id);

        if (!item || item.userId !== req.userId) {
          return res.status(404).json({ error: "Item not found" });
        }

        res.json(item);
      } catch (error) {
        console.error("Error fetching scanned item:", error);
        res.status(500).json({ error: "Failed to fetch item" });
      }
    },
  );

  app.post(
    "/api/scanned-items",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        // Extended schema for scanned items with string coercion for numeric fields
        const scannedItemInputSchema = insertScannedItemSchema.extend({
          productName: z
            .string()
            .min(1, "Product name is required")
            .default("Unknown Product"),
          calories: z
            .union([z.string(), z.number()])
            .optional()
            .transform((v) => v?.toString()),
          protein: z
            .union([z.string(), z.number()])
            .optional()
            .transform((v) => v?.toString()),
          carbs: z
            .union([z.string(), z.number()])
            .optional()
            .transform((v) => v?.toString()),
          fat: z
            .union([z.string(), z.number()])
            .optional()
            .transform((v) => v?.toString()),
          fiber: z
            .union([z.string(), z.number()])
            .optional()
            .transform((v) => v?.toString()),
          sugar: z
            .union([z.string(), z.number()])
            .optional()
            .transform((v) => v?.toString()),
          sodium: z
            .union([z.string(), z.number()])
            .optional()
            .transform((v) => v?.toString()),
        });

        const validated = scannedItemInputSchema.parse({
          ...req.body,
          userId: req.userId!,
        });

        // Transaction: create scanned item + daily log together
        const item = await db.transaction(async (tx) => {
          const [scannedItem] = await tx
            .insert(scannedItems)
            .values({
              userId: validated.userId,
              barcode: validated.barcode,
              productName: validated.productName,
              brandName: validated.brandName,
              servingSize: validated.servingSize,
              calories: validated.calories,
              protein: validated.protein,
              carbs: validated.carbs,
              fat: validated.fat,
              fiber: validated.fiber,
              sugar: validated.sugar,
              sodium: validated.sodium,
              imageUrl: validated.imageUrl,
            })
            .returning();

          await tx.insert(dailyLogs).values({
            userId: req.userId!,
            scannedItemId: scannedItem.id,
            servings: "1",
            mealType: null,
          });

          return scannedItem;
        });

        res.status(201).json(item);
      } catch (error) {
        if (error instanceof ZodError) {
          return res.status(400).json({ error: formatZodError(error) });
        }
        console.error("Error creating scanned item:", error);
        res.status(500).json({ error: "Failed to save item" });
      }
    },
  );

  app.get(
    "/api/daily-summary",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const dateParam = req.query.date as string;
        const date = dateParam ? new Date(dateParam) : new Date();

        const summary = await storage.getDailySummary(req.userId!, date);
        res.json(summary);
      } catch (error) {
        console.error("Error fetching daily summary:", error);
        res.status(500).json({ error: "Failed to fetch summary" });
      }
    },
  );

  app.get(
    "/api/subscription/status",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const subscriptionData = await storage.getSubscriptionStatus(
          req.userId!,
        );

        if (!subscriptionData) {
          return res.status(404).json({ error: "User not found" });
        }

        const tier = isValidSubscriptionTier(subscriptionData.tier)
          ? subscriptionData.tier
          : "free";
        const expiresAt = subscriptionData.expiresAt;

        // Check if premium subscription has expired
        const isActive =
          tier === "free" ||
          (tier === "premium" &&
            (!expiresAt || new Date(expiresAt) > new Date()));

        const effectiveTier: SubscriptionTier = isActive ? tier : "free";

        const response: SubscriptionStatus = {
          tier: effectiveTier,
          expiresAt: expiresAt?.toISOString() || null,
          features: TIER_FEATURES[effectiveTier],
          isActive,
        };

        res.json(response);
      } catch (error) {
        console.error("Error fetching subscription status:", error);
        res.status(500).json({ error: "Failed to fetch subscription status" });
      }
    },
  );

  app.get(
    "/api/subscription/scan-count",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const count = await storage.getDailyScanCount(req.userId!, new Date());
        res.json({ count });
      } catch (error) {
        console.error("Error fetching scan count:", error);
        res.status(500).json({ error: "Failed to fetch scan count" });
      }
    },
  );

  app.post(
    "/api/subscription/upgrade",
    requireAuth,
    subscriptionRateLimit,
    async (req: Request, res: Response) => {
      try {
        const parsed = UpgradeRequestSchema.safeParse(req.body);
        if (!parsed.success) {
          return sendError(res, 400, "Invalid request body", {
            details: parsed.error.flatten(),
          });
        }

        const { receipt, platform, productId, transactionId } = parsed.data;

        // Check for duplicate transaction
        const existing = await storage.getTransaction(transactionId);
        if (existing) {
          return sendError(res, 409, "Transaction already processed", {
            code: "ALREADY_OWNED",
          });
        }

        // Validate receipt with platform store
        const validation = await validateReceipt(receipt, platform);
        if (!validation.valid) {
          await storage.createTransaction({
            userId: req.userId!,
            transactionId,
            receipt,
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

        // Store transaction and upgrade user
        await storage.createTransaction({
          userId: req.userId!,
          transactionId,
          receipt,
          platform,
          productId,
          status: "completed",
        });

        const expiresAt = validation.expiresAt || null;
        await storage.updateSubscription(req.userId!, "premium", expiresAt);

        res.json({
          success: true,
          tier: "premium",
          expiresAt: expiresAt?.toISOString() || null,
        });
      } catch (error) {
        console.error("Error processing upgrade:", error);
        sendError(res, 500, "Failed to process upgrade");
      }
    },
  );

  app.post(
    "/api/subscription/restore",
    requireAuth,
    subscriptionRateLimit,
    async (req: Request, res: Response) => {
      try {
        const parsed = RestoreRequestSchema.safeParse(req.body);
        if (!parsed.success) {
          return sendError(res, 400, "Invalid request body", {
            details: parsed.error.flatten(),
          });
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

        const restoreId = `restore-${Date.now()}-${req.userId}`;
        await storage.createTransaction({
          userId: req.userId!,
          transactionId: restoreId,
          receipt,
          platform,
          productId: "restore",
          status: "completed",
        });

        const expiresAt = validation.expiresAt || null;
        await storage.updateSubscription(req.userId!, "premium", expiresAt);

        res.json({
          success: true,
          tier: "premium",
          expiresAt: expiresAt?.toISOString() || null,
        });
      } catch (error) {
        console.error("Error restoring purchases:", error);
        sendError(res, 500, "Failed to restore purchases");
      }
    },
  );

  app.post(
    "/api/items/:id/suggestions",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const itemId = parseInt(req.params.id as string, 10);
        if (isNaN(itemId) || itemId <= 0) {
          return res.status(400).json({ error: "Invalid item ID" });
        }

        const item = await storage.getScannedItem(itemId);

        // IDOR protection: verify user owns the item
        if (!item || item.userId !== req.userId) {
          return res.status(404).json({ error: "Item not found" });
        }

        const userProfile = await storage.getUserProfile(req.userId!);
        const profileHash = calculateProfileHash(userProfile);

        // Check cache first
        const cached = await storage.getSuggestionCache(
          itemId,
          req.userId!,
          profileHash,
        );
        if (cached) {
          // Increment hit count in background
          storage.incrementSuggestionCacheHit(cached.id).catch(console.error);
          return res.json({
            suggestions: cached.suggestions,
            cacheId: cached.id,
          });
        }

        let dietaryContext = "";
        if (userProfile) {
          if (
            userProfile.allergies &&
            Array.isArray(userProfile.allergies) &&
            userProfile.allergies.length > 0
          ) {
            dietaryContext += `User allergies (avoid these ingredients): ${(userProfile.allergies as Allergy[]).map((a) => a.name).join(", ")}. `;
          }
          if (userProfile.dietType) {
            dietaryContext += `Diet: ${userProfile.dietType}. `;
          }
          if (userProfile.cookingSkillLevel) {
            dietaryContext += `Cooking skill: ${userProfile.cookingSkillLevel}. `;
          }
          if (userProfile.cookingTimeAvailable) {
            dietaryContext += `Time: ${userProfile.cookingTimeAvailable}. `;
          }
        }

        const prompt = `Given this food item: "${item.productName}"${item.brandName ? ` by ${item.brandName}` : ""}, generate creative suggestions.

${dietaryContext ? `User preferences: ${dietaryContext}` : ""}

Generate exactly 4 suggestions in this JSON format:
{
  "suggestions": [
    {
      "type": "recipe",
      "title": "Recipe name",
      "description": "Brief 1-2 sentence description of how to use this ingredient",
      "difficulty": "Easy/Medium/Hard",
      "timeEstimate": "15 min"
    },
    {
      "type": "recipe",
      "title": "Another recipe",
      "description": "Description",
      "difficulty": "Easy",
      "timeEstimate": "30 min"
    },
    {
      "type": "craft",
      "title": "Fun kid activity with food packaging or theme",
      "description": "Brief description of a creative activity for kids",
      "timeEstimate": "20 min"
    },
    {
      "type": "pairing",
      "title": "What goes well with this",
      "description": "Complementary foods or drinks that pair nicely"
    }
  ]
}

Keep descriptions concise. Make recipes practical and kid activities fun and safe. Return only valid JSON.`;

        const completion = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content:
                "You are a helpful culinary and crafts assistant. Always respond with valid JSON only, no markdown formatting.",
            },
            { role: "user", content: prompt },
          ],
          response_format: { type: "json_object" },
          max_completion_tokens: 1024,
        });

        const responseText = completion.choices[0]?.message?.content || "{}";
        const suggestions = JSON.parse(responseText);

        // Cache the result (30 days TTL)
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        const cacheEntry = await storage.createSuggestionCache(
          itemId,
          req.userId!,
          profileHash,
          suggestions.suggestions,
          expiresAt,
        );

        res.json({
          suggestions: suggestions.suggestions,
          cacheId: cacheEntry.id,
        });
      } catch (error) {
        console.error("Error generating suggestions:", error);
        res.status(500).json({ error: "Failed to generate suggestions" });
      }
    },
  );

  // Zod schema for instructions request
  const instructionsRequestSchema = z.object({
    suggestionTitle: z.string().min(1).max(200),
    suggestionType: z.enum(["recipe", "craft", "pairing"]),
    cacheId: z.number().int().positive().optional(),
  });

  app.post(
    "/api/items/:itemId/suggestions/:suggestionIndex/instructions",
    requireAuth,
    instructionsRateLimit,
    async (req: Request, res: Response) => {
      try {
        const itemId = parseInt(req.params.itemId as string, 10);
        const suggestionIndex = parseInt(
          req.params.suggestionIndex as string,
          10,
        );

        if (isNaN(itemId) || itemId <= 0) {
          return res.status(400).json({ error: "Invalid item ID" });
        }
        if (isNaN(suggestionIndex) || suggestionIndex < 0) {
          return res.status(400).json({ error: "Invalid suggestion index" });
        }

        const item = await storage.getScannedItem(itemId);
        if (!item) {
          return res.status(404).json({ error: "Item not found" });
        }

        // Validate user owns the item
        if (item.userId !== req.userId) {
          return res.status(403).json({ error: "Not authorized" });
        }

        const parsed = instructionsRequestSchema.safeParse(req.body);
        if (!parsed.success) {
          return res
            .status(400)
            .json({ error: "Invalid input", details: parsed.error.flatten() });
        }

        const { suggestionTitle, suggestionType, cacheId } = parsed.data;

        // Check instruction cache if cacheId provided
        if (cacheId) {
          const cachedInstruction = await storage.getInstructionCache(
            cacheId,
            suggestionIndex,
          );
          if (cachedInstruction) {
            // Increment hit count in background
            storage
              .incrementInstructionCacheHit(cachedInstruction.id)
              .catch(console.error);
            return res.json({ instructions: cachedInstruction.instructions });
          }
        }

        const userProfile = await storage.getUserProfile(req.userId!);

        let dietaryContext = "";
        if (userProfile) {
          if (
            userProfile.allergies &&
            Array.isArray(userProfile.allergies) &&
            userProfile.allergies.length > 0
          ) {
            dietaryContext += `User allergies (MUST avoid): ${(userProfile.allergies as Allergy[]).map((a) => a.name).join(", ")}. `;
          }
          if (userProfile.dietType) {
            dietaryContext += `Diet: ${userProfile.dietType}. `;
          }
          if (userProfile.cookingSkillLevel) {
            dietaryContext += `Skill level: ${userProfile.cookingSkillLevel}. `;
          }
        }

        let prompt: string;
        if (suggestionType === "recipe") {
          prompt = `Write detailed cooking instructions for: "${suggestionTitle}"

This recipe uses "${item.productName}"${item.brandName ? ` by ${item.brandName}` : ""} as a main ingredient.

${dietaryContext ? `User preferences: ${dietaryContext}` : ""}

Provide clear, numbered step-by-step instructions. Include:
1. A brief ingredients list (with approximate amounts)
2. Preparation steps
3. Cooking steps
4. Any helpful tips

Keep instructions practical and easy to follow. Format as plain text with clear sections.`;
        } else if (suggestionType === "craft") {
          prompt = `Write detailed instructions for the kid-friendly activity: "${suggestionTitle}"

This activity is inspired by "${item.productName}".

Provide clear, numbered step-by-step instructions. Include:
1. Materials needed
2. Setup instructions
3. Activity steps
4. Safety notes (if applicable)
5. Fun variations or extensions

Keep instructions simple and safe for children. Format as plain text with clear sections.`;
        } else {
          // pairing
          prompt = `Explain in detail why these foods pair well: "${suggestionTitle}"

Based on "${item.productName}"${item.brandName ? ` by ${item.brandName}` : ""}.

${dietaryContext ? `User preferences: ${dietaryContext}` : ""}

Include:
1. Why these flavors complement each other
2. Serving suggestions
3. Preparation tips
4. Alternative pairings to try

Format as plain text with clear sections.`;
        }

        const completion = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content:
                "You are a helpful culinary and crafts assistant. Provide clear, practical instructions.",
            },
            { role: "user", content: prompt },
          ],
          max_completion_tokens: 1500,
        });

        const instructions =
          completion.choices[0]?.message?.content ||
          "Unable to generate instructions.";

        // Cache the instruction if we have a cacheId
        if (cacheId) {
          storage
            .createInstructionCache(
              cacheId,
              suggestionIndex,
              suggestionTitle,
              suggestionType,
              instructions,
            )
            .catch(console.error);
        }

        res.json({ instructions });
      } catch (error) {
        console.error("Error generating instructions:", error);
        res.status(500).json({ error: "Failed to generate instructions" });
      }
    },
  );

  // Zod schema for follow-up input validation
  const followUpSchema = z.object({
    question: z.string().min(1).max(500),
    answer: z.string().min(1).max(1000),
  });

  // Multer configuration for photo uploads (1MB limit for compressed images)
  const upload = multer({
    limits: { fileSize: 1 * 1024 * 1024 }, // 1MB
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

  // Avatar upload rate limiter
  const avatarRateLimit = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 5, // 5 uploads per minute
    message: { error: "Too many avatar uploads. Please wait." },
    keyGenerator: (req) => req.userId || ipKeyGenerator(req),
    standardHeaders: true,
    legacyHeaders: false,
  });

  // Avatar upload endpoint - converts image to base64 data URL
  app.post(
    "/api/user/avatar",
    requireAuth,
    avatarRateLimit,
    upload.single("avatar"),
    async (req: Request, res: Response) => {
      try {
        if (!req.file) {
          return res.status(400).json({ error: "No image provided" });
        }

        // Convert to base64 data URL (stored directly in DB for simplicity)
        const base64 = req.file.buffer.toString("base64");
        const mimeType = req.file.mimetype;
        const dataUrl = `data:${mimeType};base64,${base64}`;

        // Limit size check (already handled by multer, but double-check data URL)
        if (dataUrl.length > 1.5 * 1024 * 1024) {
          return res
            .status(400)
            .json({ error: "Image too large after encoding" });
        }

        const user = await storage.updateUser(req.userId!, {
          avatarUrl: dataUrl,
        });

        if (!user) {
          return res.status(404).json({ error: "User not found" });
        }

        res.json({
          avatarUrl: user.avatarUrl,
        });
      } catch (error) {
        console.error("Avatar upload error:", error);
        res.status(500).json({ error: "Failed to upload avatar" });
      }
    },
  );

  // Avatar delete endpoint
  app.delete(
    "/api/user/avatar",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const user = await storage.updateUser(req.userId!, {
          avatarUrl: null,
        });

        if (!user) {
          return res.status(404).json({ error: "User not found" });
        }

        res.json({ success: true });
      } catch (error) {
        console.error("Avatar delete error:", error);
        res.status(500).json({ error: "Failed to delete avatar" });
      }
    },
  );

  // In-memory store for analysis sessions
  // TODO: Replace with Redis for horizontal scaling in production
  // See: https://github.com/Xertox1234/Nutri-Cam/issues (create issue for this)
  interface AnalysisSession {
    userId: string;
    result: AnalysisResult;
    imageBase64?: string;
  }
  const analysisSessionStore = new Map<string, AnalysisSession>();

  // Track session timeout references to prevent memory leaks
  const sessionTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

  // Session timeout duration (30 minutes)
  const SESSION_TIMEOUT = 30 * 60 * 1000;

  /**
   * Clear session and its associated timeout.
   * Call this whenever a session is deleted to prevent memory leaks.
   */
  function clearSession(sessionId: string): void {
    const existingTimeout = sessionTimeouts.get(sessionId);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
      sessionTimeouts.delete(sessionId);
    }
    analysisSessionStore.delete(sessionId);
  }

  // Photo Analysis Endpoints

  app.post(
    "/api/photos/analyze",
    requireAuth,
    photoRateLimit,
    upload.single("photo"),
    async (req: Request, res: Response) => {
      try {
        // Check scan limit
        const scanCount = await storage.getDailyScanCount(
          req.userId!,
          new Date(),
        );
        const subscriptionData = await storage.getSubscriptionStatus(
          req.userId!,
        );
        const tierValue = subscriptionData?.tier || "free";
        const tier = isValidSubscriptionTier(tierValue) ? tierValue : "free";
        const features = TIER_FEATURES[tier];

        if (scanCount >= features.maxDailyScans) {
          return res.status(429).json({
            error: "Daily scan limit reached",
            scanCount,
            limit: features.maxDailyScans,
          });
        }

        if (!req.file) {
          return res.status(400).json({ error: "No photo provided" });
        }

        // Parse intent from multipart form parameters (default: "log")
        const intentRaw = (req.body?.intent as string) || "log";
        const intentParsed = photoIntentSchema.safeParse(intentRaw);
        const intent: PhotoIntent = intentParsed.success
          ? intentParsed.data
          : "log";
        const intentConfig = INTENT_CONFIG[intent];

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
          analysisSessionStore.set(sessionId, {
            userId: req.userId!,
            result: analysisResult,
            imageBase64,
          });

          // Clean up old sessions after timeout, tracking the timeout reference
          const timeoutId = setTimeout(() => {
            analysisSessionStore.delete(sessionId);
            sessionTimeouts.delete(sessionId);
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
        res.status(500).json({ error: "Failed to analyze photo" });
      }
    },
  );

  app.post(
    "/api/photos/analyze/:sessionId/followup",
    requireAuth,
    photoRateLimit,
    async (req: Request, res: Response) => {
      try {
        const sessionId = req.params.sessionId as string;

        const parsed = followUpSchema.safeParse(req.body);
        if (!parsed.success) {
          return res
            .status(400)
            .json({ error: "Invalid input", details: parsed.error.flatten() });
        }
        const { question, answer } = parsed.data;

        const session = analysisSessionStore.get(sessionId);
        if (!session) {
          return res
            .status(404)
            .json({ error: "Session not found or expired" });
        }

        // Verify session ownership
        if (session.userId !== req.userId!) {
          return res.status(403).json({ error: "Not authorized" });
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
        res.status(500).json({ error: "Failed to process follow-up" });
      }
    },
  );

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
          return res.status(403).json({ error: "Not authorized" });
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
          return res.status(400).json({ error: formatZodError(error) });
        }
        console.error("Confirm error:", error);
        res.status(500).json({ error: "Failed to save meal" });
      }
    },
  );

  // Goal Endpoints

  app.get("/api/goals", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await storage.getUser(req.userId!);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      res.json({
        dailyCalorieGoal: user.dailyCalorieGoal,
        dailyProteinGoal: user.dailyProteinGoal,
        dailyCarbsGoal: user.dailyCarbsGoal,
        dailyFatGoal: user.dailyFatGoal,
        goalsCalculatedAt: user.goalsCalculatedAt,
      });
    } catch (error) {
      console.error("Get goals error:", error);
      res.status(500).json({ error: "Failed to fetch goals" });
    }
  });

  app.post(
    "/api/goals/calculate",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const validated = userPhysicalProfileSchema.parse(req.body);

        // Calculate goals using the service
        const goals = calculateGoals(validated);

        // Update user with physical profile and calculated goals
        await storage.updateUser(req.userId!, {
          weight: validated.weight.toString(),
          height: validated.height.toString(),
          age: validated.age,
          gender: validated.gender,
          dailyCalorieGoal: goals.dailyCalories,
          dailyProteinGoal: goals.dailyProtein,
          dailyCarbsGoal: goals.dailyCarbs,
          dailyFatGoal: goals.dailyFat,
          goalsCalculatedAt: new Date(),
        });

        // Also update profile with activity level and primary goal
        const existingProfile = await storage.getUserProfile(req.userId!);
        if (existingProfile) {
          await storage.updateUserProfile(req.userId!, {
            activityLevel: validated.activityLevel,
            primaryGoal: validated.primaryGoal,
          });
        } else {
          await storage.createUserProfile({
            userId: req.userId!,
            activityLevel: validated.activityLevel,
            primaryGoal: validated.primaryGoal,
          });
        }

        res.json({
          ...goals,
          profile: {
            weight: validated.weight,
            height: validated.height,
            age: validated.age,
            gender: validated.gender,
            activityLevel: validated.activityLevel,
            primaryGoal: validated.primaryGoal,
          },
        });
      } catch (error) {
        if (error instanceof ZodError) {
          return res.status(400).json({ error: formatZodError(error) });
        }
        console.error("Calculate goals error:", error);
        res.status(500).json({ error: "Failed to calculate goals" });
      }
    },
  );

  // Zod schema for manual goal update
  const updateGoalsSchema = z.object({
    dailyCalorieGoal: z.number().int().min(500).max(10000).optional(),
    dailyProteinGoal: z.number().int().min(0).max(500).optional(),
    dailyCarbsGoal: z.number().int().min(0).max(1000).optional(),
    dailyFatGoal: z.number().int().min(0).max(500).optional(),
  });

  app.put("/api/goals", requireAuth, async (req: Request, res: Response) => {
    try {
      const validated = updateGoalsSchema.parse(req.body);

      const updatedUser = await storage.updateUser(req.userId!, {
        ...(validated.dailyCalorieGoal !== undefined && {
          dailyCalorieGoal: validated.dailyCalorieGoal,
        }),
        ...(validated.dailyProteinGoal !== undefined && {
          dailyProteinGoal: validated.dailyProteinGoal,
        }),
        ...(validated.dailyCarbsGoal !== undefined && {
          dailyCarbsGoal: validated.dailyCarbsGoal,
        }),
        ...(validated.dailyFatGoal !== undefined && {
          dailyFatGoal: validated.dailyFatGoal,
        }),
      });

      if (!updatedUser) {
        return res.status(404).json({ error: "User not found" });
      }

      res.json({
        dailyCalorieGoal: updatedUser.dailyCalorieGoal,
        dailyProteinGoal: updatedUser.dailyProteinGoal,
        dailyCarbsGoal: updatedUser.dailyCarbsGoal,
        dailyFatGoal: updatedUser.dailyFatGoal,
      });
    } catch (error) {
      if (error instanceof ZodError) {
        return res.status(400).json({ error: formatZodError(error) });
      }
      console.error("Update goals error:", error);
      res.status(500).json({ error: "Failed to update goals" });
    }
  });

  // ============================================================================
  // SAVED ITEMS ROUTES
  // ============================================================================

  app.get(
    "/api/saved-items",
    requireAuth,
    async (req: Request, res: Response): Promise<void> => {
      try {
        const items = await storage.getSavedItems(req.userId!);
        res.json(items);
      } catch (error) {
        console.error("Get saved items error:", error);
        res.status(500).json({ error: "Failed to get saved items" });
      }
    },
  );

  app.get(
    "/api/saved-items/count",
    requireAuth,
    async (req: Request, res: Response): Promise<void> => {
      try {
        const count = await storage.getSavedItemCount(req.userId!);
        res.json({ count });
      } catch (error) {
        console.error("Get saved items count error:", error);
        res.status(500).json({ error: "Failed to get saved items count" });
      }
    },
  );

  app.post(
    "/api/saved-items",
    requireAuth,
    async (req: Request, res: Response): Promise<void> => {
      try {
        const parsed = createSavedItemSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: formatZodError(parsed.error) });
          return;
        }

        const item = await storage.createSavedItem(req.userId!, parsed.data);
        if (!item) {
          res.status(403).json({ error: "LIMIT_REACHED" });
          return;
        }

        res.status(201).json(item);
      } catch (error) {
        console.error("Create saved item error:", error);
        res.status(500).json({ error: "Failed to create saved item" });
      }
    },
  );

  app.delete(
    "/api/saved-items/:id",
    requireAuth,
    async (req: Request, res: Response): Promise<void> => {
      try {
        const id = parseInt(req.params.id as string, 10);
        if (isNaN(id) || id <= 0) {
          res.status(400).json({ error: "Invalid item ID" });
          return;
        }

        // IDOR protection built into deleteSavedItem
        const deleted = await storage.deleteSavedItem(id, req.userId!);
        if (!deleted) {
          res.status(404).json({ error: "Item not found" });
          return;
        }

        res.status(204).send();
      } catch (error) {
        console.error("Delete saved item error:", error);
        res.status(500).json({ error: "Failed to delete saved item" });
      }
    },
  );

  // ============================================================================
  // COMMUNITY RECIPES ROUTES
  // ============================================================================

  // Rate limiter for recipe generation (separate from daily limit, for burst protection)
  const recipeGenerationRateLimit = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 3, // 3 requests per minute
    message: { error: "Too many recipe generation requests. Please wait." },
    keyGenerator: (req) => req.userId || ipKeyGenerator(req),
    standardHeaders: true,
    legacyHeaders: false,
  });

  // Zod schemas for recipe endpoints
  const recipeGenerationSchema = z.object({
    productName: z.string().min(1).max(200),
    barcode: z.string().max(100).optional().nullable(),
    servings: z.number().int().min(1).max(20).optional(),
    dietPreferences: z.array(z.string().max(50)).max(10).optional(),
    timeConstraint: z.string().max(50).optional(),
  });

  const recipeShareSchema = z.object({
    isPublic: z.boolean(),
  });

  // GET /api/recipes/community - Get community recipes for a product
  app.get(
    "/api/recipes/community",
    requireAuth,
    async (req: Request, res: Response): Promise<void> => {
      try {
        const barcode = (req.query.barcode as string) || null;
        const productName = req.query.productName as string;

        if (!productName) {
          res.status(400).json({ error: "productName is required" });
          return;
        }

        const normalizedName = normalizeProductName(productName);
        const recipes = await storage.getCommunityRecipes(
          barcode,
          normalizedName,
        );

        res.json(recipes);
      } catch (error) {
        console.error("Get community recipes error:", error);
        res.status(500).json({ error: "Failed to fetch recipes" });
      }
    },
  );

  // GET /api/recipes/generation-status - Get user's daily recipe generation count
  app.get(
    "/api/recipes/generation-status",
    requireAuth,
    async (req: Request, res: Response): Promise<void> => {
      try {
        const subscriptionData = await storage.getSubscriptionStatus(
          req.userId!,
        );
        const tierValue = subscriptionData?.tier || "free";
        const tier = isValidSubscriptionTier(tierValue) ? tierValue : "free";
        const features = TIER_FEATURES[tier];

        const generationsToday = await storage.getDailyRecipeGenerationCount(
          req.userId!,
          new Date(),
        );

        res.json({
          generationsToday,
          dailyLimit: features.dailyRecipeGenerations,
          canGenerate:
            features.recipeGeneration &&
            generationsToday < features.dailyRecipeGenerations,
        });
      } catch (error) {
        console.error("Get generation status error:", error);
        res.status(500).json({ error: "Failed to fetch generation status" });
      }
    },
  );

  // POST /api/recipes/generate - Generate a new recipe (premium only)
  app.post(
    "/api/recipes/generate",
    requireAuth,
    recipeGenerationRateLimit,
    async (req: Request, res: Response): Promise<void> => {
      try {
        // Check premium status
        const subscriptionData = await storage.getSubscriptionStatus(
          req.userId!,
        );
        const tierValue = subscriptionData?.tier || "free";
        const tier = isValidSubscriptionTier(tierValue) ? tierValue : "free";
        const features = TIER_FEATURES[tier];

        if (!features.recipeGeneration) {
          res.status(403).json({
            error: "PREMIUM_REQUIRED",
            message: "Recipe generation requires a premium subscription",
          });
          return;
        }

        // Check daily limit
        const generationsToday = await storage.getDailyRecipeGenerationCount(
          req.userId!,
          new Date(),
        );

        if (generationsToday >= features.dailyRecipeGenerations) {
          res.status(429).json({
            error: "DAILY_LIMIT_REACHED",
            message: "Daily recipe generation limit reached",
            generationsToday,
            dailyLimit: features.dailyRecipeGenerations,
          });
          return;
        }

        // Validate input
        const parsed = recipeGenerationSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: formatZodError(parsed.error) });
          return;
        }

        const {
          productName,
          barcode,
          servings,
          dietPreferences,
          timeConstraint,
        } = parsed.data;

        // Get user profile for dietary context
        const userProfile = await storage.getUserProfile(req.userId!);

        // Generate the recipe
        const generatedRecipe = await generateFullRecipe({
          productName,
          barcode,
          servings,
          dietPreferences,
          timeConstraint,
          userProfile,
        });

        // Save to database (initially private - user must explicitly share)
        const recipe = await storage.createCommunityRecipe({
          authorId: req.userId!,
          barcode: barcode || null,
          normalizedProductName: normalizeProductName(productName),
          title: generatedRecipe.title,
          description: generatedRecipe.description,
          difficulty: generatedRecipe.difficulty,
          timeEstimate: generatedRecipe.timeEstimate,
          servings: servings || 2,
          dietTags: generatedRecipe.dietTags,
          instructions: generatedRecipe.instructions,
          imageUrl: generatedRecipe.imageUrl,
          isPublic: false, // Private until user shares
        });

        // Log the generation for rate limiting
        await storage.logRecipeGeneration(req.userId!, recipe.id);

        res.status(201).json(recipe);
      } catch (error) {
        if (error instanceof ZodError) {
          res.status(400).json({ error: formatZodError(error) });
          return;
        }
        console.error("Recipe generation error:", error);
        res.status(500).json({ error: "Failed to generate recipe" });
      }
    },
  );

  // POST /api/recipes/:id/share - Share/unshare a recipe to community
  app.post(
    "/api/recipes/:id/share",
    requireAuth,
    async (req: Request, res: Response): Promise<void> => {
      try {
        const recipeId = parseInt(req.params.id as string, 10);
        if (isNaN(recipeId) || recipeId <= 0) {
          res.status(400).json({ error: "Invalid recipe ID" });
          return;
        }

        const parsed = recipeShareSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: formatZodError(parsed.error) });
          return;
        }

        const recipe = await storage.updateRecipePublicStatus(
          recipeId,
          req.userId!,
          parsed.data.isPublic,
        );

        if (!recipe) {
          res
            .status(404)
            .json({ error: "Recipe not found or not owned by you" });
          return;
        }

        res.json(recipe);
      } catch (error) {
        console.error("Recipe share error:", error);
        res.status(500).json({ error: "Failed to update recipe sharing" });
      }
    },
  );

  // GET /api/recipes/mine - Get user's own recipes
  app.get(
    "/api/recipes/mine",
    requireAuth,
    async (req: Request, res: Response): Promise<void> => {
      try {
        const recipes = await storage.getUserRecipes(req.userId!);
        res.json(recipes);
      } catch (error) {
        console.error("Get user recipes error:", error);
        res.status(500).json({ error: "Failed to fetch your recipes" });
      }
    },
  );

  // GET /api/recipes/:id - Get a specific recipe
  app.get(
    "/api/recipes/:id",
    requireAuth,
    async (req: Request, res: Response): Promise<void> => {
      try {
        const recipeId = parseInt(req.params.id as string, 10);
        if (isNaN(recipeId) || recipeId <= 0) {
          res.status(400).json({ error: "Invalid recipe ID" });
          return;
        }

        const recipe = await storage.getCommunityRecipe(recipeId);

        if (!recipe) {
          res.status(404).json({ error: "Recipe not found" });
          return;
        }

        // Only show public recipes or recipes owned by the user
        if (!recipe.isPublic && recipe.authorId !== req.userId) {
          res.status(404).json({ error: "Recipe not found" });
          return;
        }

        res.json(recipe);
      } catch (error) {
        console.error("Get recipe error:", error);
        res.status(500).json({ error: "Failed to fetch recipe" });
      }
    },
  );

  // DELETE /api/recipes/:id - Delete a recipe (author only)
  app.delete(
    "/api/recipes/:id",
    requireAuth,
    async (req: Request, res: Response): Promise<void> => {
      try {
        const recipeId = parseInt(req.params.id as string, 10);
        if (isNaN(recipeId) || recipeId <= 0) {
          res.status(400).json({ error: "Invalid recipe ID" });
          return;
        }

        const deleted = await storage.deleteCommunityRecipe(
          recipeId,
          req.userId!,
        );

        if (!deleted) {
          res
            .status(404)
            .json({ error: "Recipe not found or not owned by you" });
          return;
        }

        res.status(204).send();
      } catch (error) {
        console.error("Delete recipe error:", error);
        res.status(500).json({ error: "Failed to delete recipe" });
      }
    },
  );

  // ============================================================================
  // MEAL PLAN ROUTES
  // ============================================================================

  const mealPlanRateLimit = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    message: { error: "Too many meal plan requests. Please wait." },
    keyGenerator: (req) => req.userId || ipKeyGenerator(req),
    standardHeaders: true,
    legacyHeaders: false,
  });

  // Zod schemas for meal plan endpoints
  const createMealPlanRecipeSchema = z.object({
    title: z.string().min(1).max(200),
    description: z.string().max(2000).optional().nullable(),
    cuisine: z.string().max(100).optional().nullable(),
    difficulty: z.string().max(50).optional().nullable(),
    servings: z.number().int().min(1).max(50).optional(),
    prepTimeMinutes: z.number().int().min(0).max(1440).optional().nullable(),
    cookTimeMinutes: z.number().int().min(0).max(1440).optional().nullable(),
    imageUrl: z.string().max(2000).optional().nullable(),
    instructions: z.string().max(10000).optional().nullable(),
    dietTags: z.array(z.string().max(50)).max(20).optional(),
    caloriesPerServing: z
      .union([z.string(), z.number()])
      .optional()
      .nullable()
      .transform((v) => v?.toString() ?? null),
    proteinPerServing: z
      .union([z.string(), z.number()])
      .optional()
      .nullable()
      .transform((v) => v?.toString() ?? null),
    carbsPerServing: z
      .union([z.string(), z.number()])
      .optional()
      .nullable()
      .transform((v) => v?.toString() ?? null),
    fatPerServing: z
      .union([z.string(), z.number()])
      .optional()
      .nullable()
      .transform((v) => v?.toString() ?? null),
    ingredients: z
      .array(
        z.object({
          name: z.string().min(1).max(200),
          quantity: z
            .union([z.string(), z.number()])
            .optional()
            .nullable()
            .transform((v) => v?.toString() ?? null),
          unit: z.string().max(50).optional().nullable(),
          category: z.string().max(50).optional(),
        }),
      )
      .optional(),
  });

  const addMealPlanItemSchema = z.object({
    recipeId: z.number().int().positive().optional().nullable(),
    scannedItemId: z.number().int().positive().optional().nullable(),
    plannedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    mealType: z.enum(["breakfast", "lunch", "dinner", "snack"]),
    servings: z
      .union([z.string(), z.number()])
      .optional()
      .transform((v) => v?.toString()),
  });

  // GET /api/meal-plan/recipes - Get user's meal plan recipes
  app.get(
    "/api/meal-plan/recipes",
    requireAuth,
    async (req: Request, res: Response): Promise<void> => {
      try {
        const recipes = await storage.getUserMealPlanRecipes(req.userId!);
        res.json(recipes);
      } catch (error) {
        console.error("Get meal plan recipes error:", error);
        res.status(500).json({ error: "Failed to fetch recipes" });
      }
    },
  );

  // GET /api/meal-plan/recipes/:id - Get a specific recipe with ingredients
  app.get(
    "/api/meal-plan/recipes/:id",
    requireAuth,
    async (req: Request, res: Response): Promise<void> => {
      try {
        const id = parseInt(req.params.id as string, 10);
        if (isNaN(id) || id <= 0) {
          res.status(400).json({ error: "Invalid recipe ID" });
          return;
        }

        const recipe = await storage.getMealPlanRecipeWithIngredients(id);
        if (!recipe || recipe.userId !== req.userId) {
          res.status(404).json({ error: "Recipe not found" });
          return;
        }

        res.json(recipe);
      } catch (error) {
        console.error("Get meal plan recipe error:", error);
        res.status(500).json({ error: "Failed to fetch recipe" });
      }
    },
  );

  // POST /api/meal-plan/recipes - Create a meal plan recipe
  app.post(
    "/api/meal-plan/recipes",
    requireAuth,
    mealPlanRateLimit,
    async (req: Request, res: Response): Promise<void> => {
      try {
        const parsed = createMealPlanRecipeSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: formatZodError(parsed.error) });
          return;
        }

        const { ingredients, ...recipeData } = parsed.data;
        const recipe = await storage.createMealPlanRecipe(
          { ...recipeData, userId: req.userId!, sourceType: "user_created" },
          ingredients?.map((ing) => ({
            ...ing,
            recipeId: 0, // Will be set by storage method
          })),
        );

        res.status(201).json(recipe);
      } catch (error) {
        if (error instanceof ZodError) {
          res.status(400).json({ error: formatZodError(error) });
          return;
        }
        console.error("Create meal plan recipe error:", error);
        res.status(500).json({ error: "Failed to create recipe" });
      }
    },
  );

  // PUT /api/meal-plan/recipes/:id - Update a recipe
  app.put(
    "/api/meal-plan/recipes/:id",
    requireAuth,
    mealPlanRateLimit,
    async (req: Request, res: Response): Promise<void> => {
      try {
        const id = parseInt(req.params.id as string, 10);
        if (isNaN(id) || id <= 0) {
          res.status(400).json({ error: "Invalid recipe ID" });
          return;
        }

        const updateSchema = createMealPlanRecipeSchema
          .omit({ ingredients: true })
          .partial();
        const parsed = updateSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: formatZodError(parsed.error) });
          return;
        }

        const recipe = await storage.updateMealPlanRecipe(
          id,
          req.userId!,
          parsed.data,
        );
        if (!recipe) {
          res.status(404).json({ error: "Recipe not found" });
          return;
        }

        res.json(recipe);
      } catch (error) {
        if (error instanceof ZodError) {
          res.status(400).json({ error: formatZodError(error) });
          return;
        }
        console.error("Update meal plan recipe error:", error);
        res.status(500).json({ error: "Failed to update recipe" });
      }
    },
  );

  // DELETE /api/meal-plan/recipes/:id - Delete a recipe
  app.delete(
    "/api/meal-plan/recipes/:id",
    requireAuth,
    mealPlanRateLimit,
    async (req: Request, res: Response): Promise<void> => {
      try {
        const id = parseInt(req.params.id as string, 10);
        if (isNaN(id) || id <= 0) {
          res.status(400).json({ error: "Invalid recipe ID" });
          return;
        }

        const deleted = await storage.deleteMealPlanRecipe(id, req.userId!);
        if (!deleted) {
          res.status(404).json({ error: "Recipe not found" });
          return;
        }

        res.status(204).send();
      } catch (error) {
        console.error("Delete meal plan recipe error:", error);
        res.status(500).json({ error: "Failed to delete recipe" });
      }
    },
  );

  // GET /api/meal-plan - Get meal plan items for a date range
  app.get(
    "/api/meal-plan",
    requireAuth,
    async (req: Request, res: Response): Promise<void> => {
      try {
        const start = req.query.start as string;
        const end = req.query.end as string;

        if (
          !start ||
          !end ||
          !/^\d{4}-\d{2}-\d{2}$/.test(start) ||
          !/^\d{4}-\d{2}-\d{2}$/.test(end)
        ) {
          res.status(400).json({
            error: "start and end query parameters required (YYYY-MM-DD)",
          });
          return;
        }

        // Validate that the strings represent real calendar dates
        if (!isValidCalendarDate(start) || !isValidCalendarDate(end)) {
          res.status(400).json({
            error: "Invalid calendar date",
          });
          return;
        }

        // Validate start <= end
        if (start > end) {
          res.status(400).json({
            error: "start must be on or before end",
          });
          return;
        }

        // Validate max range of 90 days
        const startMs = new Date(start + "T00:00:00Z").getTime();
        const endMs = new Date(end + "T00:00:00Z").getTime();
        const diffDays = (endMs - startMs) / (1000 * 60 * 60 * 24);
        if (diffDays > 90) {
          res.status(400).json({
            error: "Date range must not exceed 90 days",
          });
          return;
        }

        const items = await storage.getMealPlanItems(req.userId!, start, end);
        res.json(items);
      } catch (error) {
        console.error("Get meal plan error:", error);
        res.status(500).json({ error: "Failed to fetch meal plan" });
      }
    },
  );

  // POST /api/meal-plan/items - Add item to meal plan
  app.post(
    "/api/meal-plan/items",
    requireAuth,
    mealPlanRateLimit,
    async (req: Request, res: Response): Promise<void> => {
      try {
        const parsed = addMealPlanItemSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: formatZodError(parsed.error) });
          return;
        }

        if (!parsed.data.recipeId && !parsed.data.scannedItemId) {
          res
            .status(400)
            .json({ error: "Either recipeId or scannedItemId is required" });
          return;
        }

        // IDOR: verify recipe or scanned item belongs to user
        if (parsed.data.recipeId) {
          const recipe = await storage.getMealPlanRecipe(parsed.data.recipeId);
          if (!recipe || recipe.userId !== req.userId) {
            res.status(404).json({ error: "Recipe not found" });
            return;
          }
        }
        if (parsed.data.scannedItemId) {
          const item = await storage.getScannedItem(parsed.data.scannedItemId);
          if (!item || item.userId !== req.userId) {
            res.status(404).json({ error: "Scanned item not found" });
            return;
          }
        }

        const mealPlanItem = await storage.addMealPlanItem({
          ...parsed.data,
          userId: req.userId!,
        });

        res.status(201).json(mealPlanItem);
      } catch (error) {
        if (error instanceof ZodError) {
          res.status(400).json({ error: formatZodError(error) });
          return;
        }
        console.error("Add meal plan item error:", error);
        res.status(500).json({ error: "Failed to add item to plan" });
      }
    },
  );

  // DELETE /api/meal-plan/items/:id - Remove item from meal plan
  app.delete(
    "/api/meal-plan/items/:id",
    requireAuth,
    async (req: Request, res: Response): Promise<void> => {
      try {
        const id = parseInt(req.params.id as string, 10);
        if (isNaN(id) || id <= 0) {
          res.status(400).json({ error: "Invalid item ID" });
          return;
        }

        const removed = await storage.removeMealPlanItem(id, req.userId!);
        if (!removed) {
          res.status(404).json({ error: "Item not found" });
          return;
        }

        res.status(204).send();
      } catch (error) {
        console.error("Remove meal plan item error:", error);
        res.status(500).json({ error: "Failed to remove item" });
      }
    },
  );

  // ============================================================================
  // AI MEAL SUGGESTIONS & GROCERY LISTS
  // ============================================================================

  const mealSuggestionRateLimit = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    message: { error: "Too many suggestion requests. Please wait." },
    keyGenerator: (req) => req.userId || ipKeyGenerator(req),
    standardHeaders: true,
    legacyHeaders: false,
  });

  const suggestMealSchema = z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    mealType: z.enum(["breakfast", "lunch", "dinner", "snack"]),
  });

  const generateGroceryListSchema = z.object({
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    title: z.string().min(1).max(200).optional(),
  });

  const addManualGroceryItemSchema = z.object({
    name: z.string().min(1).max(200),
    quantity: z
      .union([z.string(), z.number()])
      .optional()
      .nullable()
      .transform((v) => v?.toString() ?? null),
    unit: z.string().max(50).optional().nullable(),
    category: z.string().max(50).optional().default("other"),
  });

  // POST /api/meal-plan/suggest — Generate 3 AI meal suggestions (premium)
  app.post(
    "/api/meal-plan/suggest",
    requireAuth,
    mealSuggestionRateLimit,
    async (req: Request, res: Response): Promise<void> => {
      try {
        const parsed = suggestMealSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: formatZodError(parsed.error) });
          return;
        }

        // Premium check
        const subscription = await storage.getSubscriptionStatus(req.userId!);
        const tier = subscription?.tier || "free";
        const features = TIER_FEATURES[tier];

        if (!features.aiMealSuggestions) {
          res.status(403).json({
            error: "AI meal suggestions require a premium subscription",
            code: "PREMIUM_REQUIRED",
          });
          return;
        }

        // Daily limit check
        const dailyCount = await storage.getDailyMealSuggestionCount(
          req.userId!,
          new Date(),
        );
        if (dailyCount >= features.dailyAiSuggestions) {
          res.status(429).json({
            error: "Daily AI suggestion limit reached",
            code: "DAILY_LIMIT_REACHED",
            remainingToday: 0,
          });
          return;
        }

        // Build cache key
        const userProfile = await storage.getUserProfile(req.userId!);
        const user = await storage.getUser(req.userId!);
        const profileHash = userProfile
          ? calculateProfileHash(userProfile)
          : "no-profile";

        // Get existing meals for context
        const existingItems = await storage.getMealPlanItems(
          req.userId!,
          parsed.data.date,
          parsed.data.date,
        );
        const existingMeals = existingItems.map((item) => ({
          title:
            item.recipe?.title || item.scannedItem?.productName || "Unknown",
          calories: parseFloat(
            item.recipe?.caloriesPerServing ||
              item.scannedItem?.calories ||
              "0",
          ),
          mealType: item.mealType,
        }));

        const planHash = JSON.stringify(
          existingMeals.map((m) => m.title).sort(),
        );
        const cacheKey = buildSuggestionCacheKey(
          req.userId!,
          parsed.data.date,
          parsed.data.mealType,
          profileHash,
          planHash,
        );

        // Cache check
        const cached = await storage.getMealSuggestionCache(cacheKey);
        if (cached) {
          await storage.incrementMealSuggestionCacheHit(cached.id);
          const remaining = features.dailyAiSuggestions - dailyCount;
          res.json({
            suggestions: cached.suggestions as MealSuggestion[],
            remainingToday: remaining,
          });
          return;
        }

        // Calculate remaining budget
        const dailyTargets = {
          calories: user?.dailyCalorieGoal || 2000,
          protein: user?.dailyProteinGoal || 100,
          carbs: user?.dailyCarbsGoal || 250,
          fat: user?.dailyFatGoal || 65,
        };

        let consumedCalories = 0;
        let consumedProtein = 0;
        let consumedCarbs = 0;
        let consumedFat = 0;
        for (const meal of existingMeals) {
          consumedCalories += meal.calories;
        }
        for (const item of existingItems) {
          const servings = parseFloat(item.servings || "1");
          if (item.recipe) {
            consumedProtein +=
              parseFloat(item.recipe.proteinPerServing || "0") * servings;
            consumedCarbs +=
              parseFloat(item.recipe.carbsPerServing || "0") * servings;
            consumedFat +=
              parseFloat(item.recipe.fatPerServing || "0") * servings;
          } else if (item.scannedItem) {
            consumedProtein +=
              parseFloat(item.scannedItem.protein || "0") * servings;
            consumedCarbs +=
              parseFloat(item.scannedItem.carbs || "0") * servings;
            consumedFat += parseFloat(item.scannedItem.fat || "0") * servings;
          }
        }

        const remainingBudget = {
          calories: Math.max(0, dailyTargets.calories - consumedCalories),
          protein: Math.max(0, dailyTargets.protein - consumedProtein),
          carbs: Math.max(0, dailyTargets.carbs - consumedCarbs),
          fat: Math.max(0, dailyTargets.fat - consumedFat),
        };

        const suggestions = await generateMealSuggestions({
          userId: req.userId!,
          date: parsed.data.date,
          mealType: parsed.data.mealType,
          userProfile: userProfile || null,
          dailyTargets,
          existingMeals,
          remainingBudget,
        });

        // Cache result (expires in 6 hours)
        const expiresAt = new Date(Date.now() + 6 * 60 * 60 * 1000);
        await storage.createMealSuggestionCache(
          cacheKey,
          req.userId!,
          suggestions,
          expiresAt,
        );

        const remaining = features.dailyAiSuggestions - dailyCount - 1;
        res.json({ suggestions, remainingToday: Math.max(0, remaining) });
      } catch (error) {
        if (error instanceof ZodError) {
          res.status(400).json({ error: formatZodError(error) });
          return;
        }
        console.error("Meal suggestion error:", error);
        res.status(500).json({ error: "Failed to generate suggestions" });
      }
    },
  );

  // POST /api/meal-plan/grocery-lists — Generate grocery list from date range
  app.post(
    "/api/meal-plan/grocery-lists",
    requireAuth,
    mealPlanRateLimit,
    async (req: Request, res: Response): Promise<void> => {
      try {
        const parsed = generateGroceryListSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: formatZodError(parsed.error) });
          return;
        }

        if (
          !isValidCalendarDate(parsed.data.startDate) ||
          !isValidCalendarDate(parsed.data.endDate)
        ) {
          res.status(400).json({ error: "Invalid date format" });
          return;
        }

        if (parsed.data.startDate > parsed.data.endDate) {
          res.status(400).json({ error: "Start date must be before end date" });
          return;
        }

        // Fetch ingredients from planned meals
        const ingredients = await storage.getMealPlanIngredientsForDateRange(
          req.userId!,
          parsed.data.startDate,
          parsed.data.endDate,
        );

        // Aggregate
        const aggregated = generateGroceryItems(ingredients);

        // Default title
        const title =
          parsed.data.title ||
          `Grocery List ${parsed.data.startDate} to ${parsed.data.endDate}`;

        // Create list
        const list = await storage.createGroceryList({
          userId: req.userId!,
          title,
          dateRangeStart: parsed.data.startDate,
          dateRangeEnd: parsed.data.endDate,
        });

        // Create items
        const items = [];
        for (const agg of aggregated) {
          const item = await storage.addGroceryListItem({
            groceryListId: list.id,
            name: agg.name,
            quantity: agg.quantity?.toString() || null,
            unit: agg.unit,
            category: agg.category,
          });
          items.push(item);
        }

        res.status(201).json({ ...list, items });
      } catch (error) {
        if (error instanceof ZodError) {
          res.status(400).json({ error: formatZodError(error) });
          return;
        }
        console.error("Generate grocery list error:", error);
        res.status(500).json({ error: "Failed to generate grocery list" });
      }
    },
  );

  // GET /api/meal-plan/grocery-lists — List user's grocery lists
  app.get(
    "/api/meal-plan/grocery-lists",
    requireAuth,
    async (req: Request, res: Response): Promise<void> => {
      try {
        const lists = await storage.getGroceryLists(req.userId!);
        res.json(lists);
      } catch (error) {
        console.error("Get grocery lists error:", error);
        res.status(500).json({ error: "Failed to fetch grocery lists" });
      }
    },
  );

  // GET /api/meal-plan/grocery-lists/:id — Get list with items
  app.get(
    "/api/meal-plan/grocery-lists/:id",
    requireAuth,
    async (req: Request, res: Response): Promise<void> => {
      try {
        const id = parseInt(req.params.id as string, 10);
        if (isNaN(id) || id <= 0) {
          res.status(400).json({ error: "Invalid list ID" });
          return;
        }

        const list = await storage.getGroceryListWithItems(id, req.userId!);
        if (!list) {
          res.status(404).json({ error: "Grocery list not found" });
          return;
        }

        res.json(list);
      } catch (error) {
        console.error("Get grocery list error:", error);
        res.status(500).json({ error: "Failed to fetch grocery list" });
      }
    },
  );

  // PUT /api/meal-plan/grocery-lists/:id/items/:itemId — Toggle item checked
  app.put(
    "/api/meal-plan/grocery-lists/:id/items/:itemId",
    requireAuth,
    async (req: Request, res: Response): Promise<void> => {
      try {
        const listId = parseInt(req.params.id as string, 10);
        const itemId = parseInt(req.params.itemId as string, 10);
        if (isNaN(listId) || listId <= 0 || isNaN(itemId) || itemId <= 0) {
          res.status(400).json({ error: "Invalid ID" });
          return;
        }

        // IDOR: verify list belongs to user
        const list = await storage.getGroceryListWithItems(listId, req.userId!);
        if (!list) {
          res.status(404).json({ error: "Grocery list not found" });
          return;
        }

        const isChecked =
          typeof req.body.isChecked === "boolean" ? req.body.isChecked : true;
        const updated = await storage.updateGroceryListItemChecked(
          itemId,
          listId,
          isChecked,
        );
        if (!updated) {
          res.status(404).json({ error: "Item not found" });
          return;
        }

        res.json(updated);
      } catch (error) {
        console.error("Toggle grocery item error:", error);
        res.status(500).json({ error: "Failed to update item" });
      }
    },
  );

  // POST /api/meal-plan/grocery-lists/:id/items — Add manual item
  app.post(
    "/api/meal-plan/grocery-lists/:id/items",
    requireAuth,
    async (req: Request, res: Response): Promise<void> => {
      try {
        const listId = parseInt(req.params.id as string, 10);
        if (isNaN(listId) || listId <= 0) {
          res.status(400).json({ error: "Invalid list ID" });
          return;
        }

        // IDOR: verify list belongs to user
        const list = await storage.getGroceryListWithItems(listId, req.userId!);
        if (!list) {
          res.status(404).json({ error: "Grocery list not found" });
          return;
        }

        const parsed = addManualGroceryItemSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: formatZodError(parsed.error) });
          return;
        }

        const item = await storage.addGroceryListItem({
          groceryListId: listId,
          name: parsed.data.name,
          quantity: parsed.data.quantity,
          unit: parsed.data.unit || null,
          category: parsed.data.category || "other",
          isManual: true,
        });

        res.status(201).json(item);
      } catch (error) {
        if (error instanceof ZodError) {
          res.status(400).json({ error: formatZodError(error) });
          return;
        }
        console.error("Add grocery item error:", error);
        res.status(500).json({ error: "Failed to add item" });
      }
    },
  );

  // DELETE /api/meal-plan/grocery-lists/:id — Delete grocery list
  app.delete(
    "/api/meal-plan/grocery-lists/:id",
    requireAuth,
    async (req: Request, res: Response): Promise<void> => {
      try {
        const id = parseInt(req.params.id as string, 10);
        if (isNaN(id) || id <= 0) {
          res.status(400).json({ error: "Invalid list ID" });
          return;
        }

        const deleted = await storage.deleteGroceryList(id, req.userId!);
        if (!deleted) {
          res.status(404).json({ error: "Grocery list not found" });
          return;
        }

        res.status(204).send();
      } catch (error) {
        console.error("Delete grocery list error:", error);
        res.status(500).json({ error: "Failed to delete grocery list" });
      }
    },
  );

  // ============================================================================
  // RECIPE CATALOG & URL IMPORT ROUTES
  // ============================================================================

  const urlImportRateLimit = rateLimit({
    windowMs: 60 * 1000,
    max: 5,
    message: { error: "Too many import requests. Please wait." },
    keyGenerator: (req) => req.userId || ipKeyGenerator(req),
    standardHeaders: true,
    legacyHeaders: false,
  });

  const catalogSearchSchema = z.object({
    query: z.string().min(1).max(200),
    cuisine: z.string().max(100).optional(),
    diet: z.string().max(100).optional(),
    type: z.string().max(100).optional(),
    maxReadyTime: z.coerce.number().int().min(1).max(1440).optional(),
    offset: z.coerce.number().int().min(0).optional(),
    number: z.coerce.number().int().min(1).max(50).optional(),
  });

  const importUrlSchema = z.object({
    url: z.string().url().max(2000),
  });

  // GET /api/meal-plan/catalog/search — Spoonacular search
  app.get(
    "/api/meal-plan/catalog/search",
    requireAuth,
    mealPlanRateLimit,
    async (req: Request, res: Response): Promise<void> => {
      try {
        const parsed = catalogSearchSchema.safeParse(req.query);
        if (!parsed.success) {
          res.status(400).json({ error: formatZodError(parsed.error) });
          return;
        }

        const results = await searchCatalogRecipes(parsed.data);
        res.json(results);
      } catch (error) {
        if (error instanceof CatalogQuotaError) {
          res
            .status(402)
            .json({ error: "CATALOG_QUOTA_EXCEEDED", message: error.message });
          return;
        }
        console.error("Catalog search error:", error);
        res.status(500).json({ error: "Failed to search recipes" });
      }
    },
  );

  // GET /api/meal-plan/catalog/:id — Spoonacular recipe detail (preview)
  app.get(
    "/api/meal-plan/catalog/:id",
    requireAuth,
    mealPlanRateLimit,
    async (req: Request, res: Response): Promise<void> => {
      try {
        const id = parseInt(req.params.id as string, 10);
        if (isNaN(id) || id <= 0) {
          res.status(400).json({ error: "Invalid catalog ID" });
          return;
        }

        const detail = await getCatalogRecipeDetail(id);
        if (!detail) {
          res.status(404).json({ error: "Recipe not found in catalog" });
          return;
        }

        res.json(detail);
      } catch (error) {
        if (error instanceof CatalogQuotaError) {
          res
            .status(402)
            .json({ error: "CATALOG_QUOTA_EXCEEDED", message: error.message });
          return;
        }
        console.error("Catalog detail error:", error);
        res.status(500).json({ error: "Failed to fetch recipe detail" });
      }
    },
  );

  // POST /api/meal-plan/catalog/:id/save — Save catalog recipe to DB
  app.post(
    "/api/meal-plan/catalog/:id/save",
    requireAuth,
    mealPlanRateLimit,
    async (req: Request, res: Response): Promise<void> => {
      try {
        const id = parseInt(req.params.id as string, 10);
        if (isNaN(id) || id <= 0) {
          res.status(400).json({ error: "Invalid catalog ID" });
          return;
        }

        // Dedup: check if already saved
        const existing = await storage.findMealPlanRecipeByExternalId(
          req.userId!,
          String(id),
        );
        if (existing) {
          res.json(existing);
          return;
        }

        // Fetch from Spoonacular
        const detail = await getCatalogRecipeDetail(id);
        if (!detail) {
          res.status(404).json({ error: "Recipe not found in catalog" });
          return;
        }

        // Set the userId and save
        detail.recipe.userId = req.userId!;
        const saved = await storage.createMealPlanRecipe(
          detail.recipe,
          detail.ingredients,
        );

        res.status(201).json(saved);
      } catch (error) {
        if (error instanceof CatalogQuotaError) {
          res
            .status(402)
            .json({ error: "CATALOG_QUOTA_EXCEEDED", message: error.message });
          return;
        }
        console.error("Catalog save error:", error);
        res.status(500).json({ error: "Failed to save catalog recipe" });
      }
    },
  );

  // POST /api/meal-plan/recipes/import-url — Import recipe from URL
  app.post(
    "/api/meal-plan/recipes/import-url",
    requireAuth,
    urlImportRateLimit,
    async (req: Request, res: Response): Promise<void> => {
      try {
        const parsed = importUrlSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: formatZodError(parsed.error) });
          return;
        }

        const result = await importRecipeFromUrl(parsed.data.url);

        if (!result.success) {
          const messages: Record<string, string> = {
            FETCH_FAILED: "Could not fetch the URL",
            NO_RECIPE_DATA: "No recipe data found on this page",
            PARSE_ERROR: "Could not parse recipe data from this page",
            TIMEOUT: "The request timed out while fetching the URL",
            RESPONSE_TOO_LARGE: "The page is too large to import (max 5 MB)",
          };
          res.status(422).json({
            error: result.error,
            message: messages[result.error] || "Import failed",
          });
          return;
        }

        // Save to DB
        const { data } = result;
        const recipe = await storage.createMealPlanRecipe(
          {
            userId: req.userId!,
            title: data.title,
            description: data.description,
            sourceType: "url_import",
            sourceUrl: data.sourceUrl,
            cuisine: data.cuisine,
            servings: data.servings || 2,
            prepTimeMinutes: data.prepTimeMinutes,
            cookTimeMinutes: data.cookTimeMinutes,
            imageUrl: data.imageUrl,
            instructions: data.instructions,
            dietTags: data.dietTags,
            caloriesPerServing: data.caloriesPerServing,
            proteinPerServing: data.proteinPerServing,
            carbsPerServing: data.carbsPerServing,
            fatPerServing: data.fatPerServing,
          },
          data.ingredients.map((ing, idx) => ({
            recipeId: 0,
            name: ing.name,
            quantity: ing.quantity,
            unit: ing.unit,
            category: "other",
            displayOrder: idx,
          })),
        );

        res.status(201).json(recipe);
      } catch (error) {
        console.error("URL import error:", error);
        res.status(500).json({ error: "Failed to import recipe" });
      }
    },
  );

  // Multer error handler - returns 400 for file validation errors instead of 500
  app.use(
    (
      err: Error,
      req: Request,
      res: Response,
      next: (err?: Error) => void,
    ): void => {
      if (err instanceof MulterError) {
        res.status(400).json({ error: err.message, code: err.code });
        return;
      }
      if (err.message?.includes("Invalid file type")) {
        res.status(400).json({ error: err.message });
        return;
      }
      next(err);
    },
  );

  const httpServer = createServer(app);

  return httpServer;
}
