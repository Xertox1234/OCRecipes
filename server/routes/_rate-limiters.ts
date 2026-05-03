/**
 * Rate limiter factory and pre-configured rate limiter instances.
 */
import type { Request } from "express";
import { rateLimit } from "express-rate-limit";

/** Extract IP address for rate limiting fallback when user is not authenticated */
export function ipKeyGenerator(req: Request): string {
  return req.ip || req.socket.remoteAddress || "unknown";
}

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

export const remindersPendingRateLimit = createRateLimiter({
  windowMs: 60 * 1000,
  max: 60,
  message: "Too many reminder requests. Please wait.",
});

export const remindersAcknowledgeRateLimit = createRateLimiter({
  windowMs: 60 * 1000,
  max: 20,
  message: "Too many acknowledge requests. Please wait.",
});

export const remindersMutesRateLimit = createRateLimiter({
  windowMs: 60 * 1000,
  max: 30,
  message: "Too many mute requests. Please wait.",
});
