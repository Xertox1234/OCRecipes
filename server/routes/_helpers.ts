/**
 * Shared helpers, rate limiters, schemas, and utilities used across route modules.
 */
import type { Request, Response } from "express";
import OpenAI from "openai";
import { rateLimit } from "express-rate-limit";
import { z, ZodError } from "zod";
import multer from "multer";
import { storage } from "../storage";
import {
  TIER_FEATURES,
  isValidSubscriptionTier,
  type PremiumFeatures,
} from "@shared/types/premium";
import { insertUserProfileSchema, allergySchema } from "@shared/schema";

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Check if the user has a premium feature. Returns the features object if granted,
 * or sends a 403 response and returns null if not.
 */
export async function checkPremiumFeature(
  req: Request,
  res: Response,
  featureKey: keyof PremiumFeatures,
  featureLabel: string,
): Promise<PremiumFeatures | null> {
  const subscription = await storage.getSubscriptionStatus(req.userId!);
  const tier = subscription?.tier || "free";
  const features = TIER_FEATURES[isValidSubscriptionTier(tier) ? tier : "free"];
  if (!features[featureKey]) {
    res.status(403).json({
      error: `${featureLabel} requires a premium subscription`,
      code: "PREMIUM_REQUIRED",
    });
    return null;
  }
  return features;
}

/**
 * Parse a route parameter as a positive integer. Returns the parsed number,
 * or null if the value is not a valid positive integer (rejects NaN, 0, and negatives).
 */
export function parsePositiveIntParam(value: string): number | null {
  const num = parseInt(value, 10);
  if (isNaN(num) || num <= 0) return null;
  return num;
}

/** Extract IP address for rate limiting fallback when user is not authenticated */
export function ipKeyGenerator(req: Request): string {
  return req.ip || req.socket.remoteAddress || "unknown";
}

/** Format Zod validation errors as a simple string */
export function formatZodError(error: ZodError): string {
  return error.errors
    .map((e) =>
      e.path.length ? `${e.path.join(".")}: ${e.message}` : e.message,
    )
    .join("; ");
}

// ============================================================================
// RATE LIMITERS
// ============================================================================

export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 attempts per window
  message: { error: "Too many login attempts, please try again later" },
  standardHeaders: true,
  legacyHeaders: false,
});

export const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // 5 registrations per hour
  message: { error: "Too many registration attempts, please try again later" },
  standardHeaders: true,
  legacyHeaders: false,
});

export const photoRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 requests per minute
  message: { error: "Too many photo uploads. Please wait." },
  keyGenerator: (req) => req.userId || ipKeyGenerator(req),
  standardHeaders: true,
  legacyHeaders: false,
});

export const instructionsRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20, // 20 requests per minute per user
  message: { error: "Too many instruction requests. Please wait." },
  keyGenerator: (req) => req.userId || ipKeyGenerator(req),
  standardHeaders: true,
  legacyHeaders: false,
});

export const nutritionLookupRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 15, // 15 requests per minute per user
  message: { error: "Too many nutrition lookups. Please wait." },
  keyGenerator: (req) => req.userId || ipKeyGenerator(req),
  standardHeaders: true,
  legacyHeaders: false,
});

export const subscriptionRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 attempts per window
  message: { error: "Too many subscription requests. Please wait." },
  keyGenerator: (req) => req.userId || ipKeyGenerator(req),
  standardHeaders: true,
  legacyHeaders: false,
});

export const pantryRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // 30 requests per minute per user
  message: { error: "Too many pantry requests. Please wait." },
  keyGenerator: (req) => req.userId || ipKeyGenerator(req),
  standardHeaders: true,
  legacyHeaders: false,
});

export const mealConfirmRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20, // 20 confirmations per minute per user
  message: { error: "Too many confirmation requests. Please wait." },
  keyGenerator: (req) => req.userId || ipKeyGenerator(req),
  standardHeaders: true,
  legacyHeaders: false,
});

export const mealPlanRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: "Too many meal plan requests. Please wait." },
  keyGenerator: (req) => req.userId || ipKeyGenerator(req),
  standardHeaders: true,
  legacyHeaders: false,
});

export const mealSuggestionRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: "Too many suggestion requests. Please wait." },
  keyGenerator: (req) => req.userId || ipKeyGenerator(req),
  standardHeaders: true,
  legacyHeaders: false,
});

export const recipeGenerationRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 3, // 3 requests per minute
  message: { error: "Too many recipe generation requests. Please wait." },
  keyGenerator: (req) => req.userId || ipKeyGenerator(req),
  standardHeaders: true,
  legacyHeaders: false,
});

export const avatarRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5, // 5 uploads per minute
  message: { error: "Too many avatar uploads. Please wait." },
  keyGenerator: (req) => req.userId || ipKeyGenerator(req),
  standardHeaders: true,
  legacyHeaders: false,
});

export const urlImportRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { error: "Too many import requests. Please wait." },
  keyGenerator: (req) => req.userId || ipKeyGenerator(req),
  standardHeaders: true,
  legacyHeaders: false,
});

// ============================================================================
// OPENAI INSTANCE
// ============================================================================

export const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

// ============================================================================
// MULTER UPLOAD CONFIG
// ============================================================================

// Multer configuration for photo uploads (1MB limit for compressed images)
export const upload = multer({
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

// ============================================================================
// COMMON VALIDATION SCHEMAS
// ============================================================================

// Login validation schema - lighter than registration (no format rules, just bounds)
export const loginSchema = z.object({
  username: z.string().min(1, "Username is required").max(30),
  password: z.string().min(1, "Password is required").max(200),
});

// Registration validation schema with username format and password strength
export const registerSchema = z.object({
  username: z
    .string()
    .min(3, "Username must be at least 3 characters")
    .max(30, "Username must be at most 30 characters")
    .regex(
      /^[a-zA-Z0-9_]+$/,
      "Username can only contain letters, numbers, and underscores",
    ),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(200),
});

// Profile update validation schema
export const profileUpdateSchema = z.object({
  displayName: z.string().max(100).optional(),
  dailyCalorieGoal: z.number().int().min(500).max(10000).optional(),
  onboardingCompleted: z.boolean().optional(),
});

// Enhanced user profile schema with proper validation for nested objects
export const userProfileInputSchema = insertUserProfileSchema.extend({
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
