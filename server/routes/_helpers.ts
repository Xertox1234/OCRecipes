/**
 * Shared helpers, rate limiters, schemas, and utilities used across route modules.
 */
import type { Request, Response } from "express";
import { rateLimit } from "express-rate-limit";
import { z, ZodError } from "zod";
import multer from "multer";
import { storage } from "../storage";
import { sendError } from "../lib/api-errors";
import {
  TIER_FEATURES,
  isValidSubscriptionTier,
  type PremiumFeatures,
} from "@shared/types/premium";
import { ErrorCode } from "@shared/constants/error-codes";
import { insertUserProfileSchema, allergySchema } from "@shared/schema";
import { isAiConfigured } from "../lib/openai";

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Resolve the current user's premium features object.
 * Looks up subscription status and safely validates the tier before indexing.
 * Use this when you need the features object without gating on a specific boolean feature.
 */
export async function getPremiumFeatures(
  req: Request,
): Promise<PremiumFeatures> {
  const subscription = await storage.getSubscriptionStatus(req.userId!);
  const tier = subscription?.tier || "free";
  return TIER_FEATURES[isValidSubscriptionTier(tier) ? tier : "free"];
}

/**
 * Guard that returns false (and sends 503) if AI features are not configured.
 * Use at the top of route handlers that depend on OpenAI.
 */
export function checkAiConfigured(res: Response): boolean {
  if (!isAiConfigured) {
    sendError(
      res,
      503,
      "AI features are not available. Please try again later.",
      "AI_NOT_CONFIGURED",
    );
    return false;
  }
  return true;
}

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
  const features = await getPremiumFeatures(req);
  if (!features[featureKey]) {
    sendError(
      res,
      403,
      `${featureLabel} requires a premium subscription`,
      ErrorCode.PREMIUM_REQUIRED,
    );
    return null;
  }
  return features;
}

/**
 * Parse a route parameter as a positive integer. Returns the parsed number,
 * or null if the value is not a valid positive integer (rejects NaN, 0, and negatives).
 * Accepts `string | string[]` to match Express 5's req.params type without requiring `as string` casts.
 */
export function parsePositiveIntParam(value: string | string[]): number | null {
  const str = Array.isArray(value) ? value[0] : value;
  if (!str) return null;
  const num = parseInt(str, 10);
  if (isNaN(num) || num <= 0) return null;
  return num;
}

/**
 * Parse a query string parameter as an integer with default, min, and max clamping.
 * Handles the `as string` cast internally so callers don't need it.
 */
export function parseQueryInt(
  value: unknown,
  options: { default: number; min?: number; max?: number },
): number {
  const num = typeof value === "string" ? parseInt(value, 10) : NaN;
  let result = isNaN(num) ? options.default : num;
  if (options.min !== undefined) result = Math.max(result, options.min);
  if (options.max !== undefined) result = Math.min(result, options.max);
  return result;
}

/**
 * Parse a query string parameter as a Date. Returns undefined if the value
 * is missing or not a valid date string.
 */
export function parseQueryDate(value: unknown): Date | undefined {
  if (typeof value !== "string" || !value) return undefined;
  const date = new Date(value);
  if (isNaN(date.getTime())) return undefined;
  return date;
}

/**
 * Parse a query string parameter as a trimmed string. Returns undefined if the
 * value is missing or not a string. Handles Express 5's `unknown` query type
 * without requiring an `as string` cast.
 */
export function parseQueryString(value: unknown): string | undefined {
  if (typeof value !== "string" || !value) return undefined;
  return value;
}

/**
 * Parse a route parameter as a string. Handles Express 5's `string | string[]`
 * param type without requiring an `as string` cast.
 */
export function parseStringParam(
  value: string | string[] | undefined,
): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
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
// RATE LIMITER FACTORY
// ============================================================================

/**
 * Factory for creating express-rate-limit middleware with consistent defaults.
 * Uses userId (falling back to IP) as the key for authenticated routes,
 * or default IP-based keying for unauthenticated routes.
 */
export function createRateLimiter(options: {
  windowMs: number;
  max: number;
  message: string;
  keyByUser?: boolean;
}) {
  return rateLimit({
    windowMs: options.windowMs,
    max: options.max,
    message: { error: options.message, code: "RATE_LIMITED" },
    standardHeaders: true,
    legacyHeaders: false,
    ...(options.keyByUser !== false && {
      keyGenerator: (req: Request) => req.userId || ipKeyGenerator(req),
    }),
  });
}

// ============================================================================
// RATE LIMITERS
// ============================================================================

// --- Auth (IP-keyed, no userId available) ---
export const loginLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: "Too many login attempts, please try again later",
  keyByUser: false,
});

export const registerLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: "Too many registration attempts, please try again later",
  keyByUser: false,
});

export const accountDeletionLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: "Too many account deletion attempts, please try again later",
  keyByUser: false,
});

// --- User-keyed rate limiters ---
export const photoRateLimit = createRateLimiter({
  windowMs: 60 * 1000,
  max: 10,
  message: "Too many photo uploads. Please wait.",
});

export const suggestionsRateLimit = createRateLimiter({
  windowMs: 60 * 1000,
  max: 10,
  message: "Too many suggestion requests. Please wait.",
});

export const instructionsRateLimit = createRateLimiter({
  windowMs: 60 * 1000,
  max: 20,
  message: "Too many instruction requests. Please wait.",
});

export const nutritionLookupRateLimit = createRateLimiter({
  windowMs: 60 * 1000,
  max: 15,
  message: "Too many nutrition lookups. Please wait.",
});

export const subscriptionRateLimit = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: "Too many subscription requests. Please wait.",
});

export const pantryRateLimit = createRateLimiter({
  windowMs: 60 * 1000,
  max: 30,
  message: "Too many pantry requests. Please wait.",
});

export const mealConfirmRateLimit = createRateLimiter({
  windowMs: 60 * 1000,
  max: 20,
  message: "Too many confirmation requests. Please wait.",
});

export const mealPlanRateLimit = createRateLimiter({
  windowMs: 60 * 1000,
  max: 30,
  message: "Too many meal plan requests. Please wait.",
});

export const mealSuggestionRateLimit = createRateLimiter({
  windowMs: 60 * 1000,
  max: 10,
  message: "Too many suggestion requests. Please wait.",
});

export const pantryMealPlanRateLimit = createRateLimiter({
  windowMs: 60 * 1000,
  max: 2,
  message: "Too many meal plan generation requests. Please wait.",
});

export const recipeGenerationRateLimit = createRateLimiter({
  windowMs: 60 * 1000,
  max: 3,
  message: "Too many recipe generation requests. Please wait.",
});

export const avatarRateLimit = createRateLimiter({
  windowMs: 60 * 1000,
  max: 5,
  message: "Too many avatar uploads. Please wait.",
});

export const urlImportRateLimit = createRateLimiter({
  windowMs: 60 * 1000,
  max: 5,
  message: "Too many import requests. Please wait.",
});

// --- General-purpose CRUD rate limiter (for routes without a domain-specific one) ---
export const crudRateLimit = createRateLimiter({
  windowMs: 60 * 1000,
  max: 30,
  message: "Too many requests. Please wait.",
});

// --- Route-specific rate limiters (consolidated from route files) ---
export const fastingRateLimit = createRateLimiter({
  windowMs: 60 * 1000,
  max: 30,
  message: "Too many fasting requests. Please wait.",
});

export const medicationRateLimit = createRateLimiter({
  windowMs: 60 * 1000,
  max: 30,
  message: "Too many medication requests. Please wait.",
});

export const menuRateLimit = createRateLimiter({
  windowMs: 60 * 1000,
  max: 5,
  message: "Too many menu scan requests. Please wait.",
});

export const chatRateLimit = createRateLimiter({
  windowMs: 60 * 1000,
  max: 20,
  message: "Too many chat requests. Please wait.",
});

export const micronutrientRateLimit = createRateLimiter({
  windowMs: 60 * 1000,
  max: 20,
  message: "Too many micronutrient requests. Please wait.",
});

export const foodParseRateLimit = createRateLimiter({
  windowMs: 60 * 1000,
  max: 20,
  message: "Too many food parse requests. Please wait.",
});

export const allergenCheckRateLimit = createRateLimiter({
  windowMs: 60 * 1000,
  max: 20,
  message: "Too many allergen check requests. Please wait.",
});

// ============================================================================
// MULTER UPLOAD CONFIG
// ============================================================================

/** Factory for image upload multer configs with consistent fileFilter. */
export function createImageUpload(maxSizeBytes: number) {
  return multer({
    limits: { fileSize: maxSizeBytes },
    storage: multer.memoryStorage(),
    fileFilter: (_req, file, cb) => {
      const allowedMimes = ["image/jpeg", "image/png", "image/webp"];
      if (allowedMimes.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error("Invalid file type. Only JPEG, PNG, and WebP allowed."));
      }
    },
  });
}

// Multer configuration for photo uploads (1MB limit for compressed images)
export const upload = createImageUpload(1 * 1024 * 1024);

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
    .max(200)
    .regex(
      /(?=.*[a-zA-Z])(?=.*\d)/,
      "Password must contain at least one letter and one number",
    ),
});

// Account deletion validation schema
export const deleteAccountSchema = z.object({
  password: z.string().min(1, "Password is required"),
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

/** Check if userId is in the ADMIN_USER_IDS env var */
export function isAdmin(userId: string): boolean {
  const adminIds = (process.env.ADMIN_USER_IDS ?? "")
    .split(",")
    .filter(Boolean);
  return adminIds.includes(userId);
}
